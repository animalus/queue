import { AbstractQueueWorker, Queue, QueueWorkerOptions } from "../src/queue";

export type QueueThing = {
    duration: number;
    id: number;
    error?: boolean;
    cancel?: boolean;
};

class JobThing extends AbstractQueueWorker<QueueThing, number> {
    timer;

    doWork(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            if (this.obj.error) {
                this.timer = setTimeout(() => {
                    reject("Something bad has happened.");
                }, 100);
            } else {
                this.timer = setTimeout(() => {
                    resolve(this.obj.id * this.obj.id);
                }, this.obj.duration);

                if (this.obj.cancel) {
                    setTimeout(() => {
                        this.cancel();
                    }, this.obj.duration / 2);
                }
            }
        }).finally(() => {
            clearTimeout(this.timer);
        });
    }
}

var q = new Queue((obj: QueueThing) => obj.id, {
    timeout: 3000,
    concurrency: process.argv.length > 2 ? parseInt(process.argv[2]) : 2,
});

function makeJob(
    id,
    duration,
    error: boolean = false,
    cancel: boolean = false,
    options?: QueueWorkerOptions<number>
) {
    return new JobThing({ id, duration, error, cancel } as QueueThing, options);
}

q.on(
    "timeout",
    (next: (err?: any, result?: QueueThing) => void, obj: QueueThing) => {
        console.log(`job [${obj.id}] timed out.`);
    }
);

q.on("queued", (obj: QueueThing, queueLength: number) => {
    console.log(`job [${obj.id}] was queued.`);
});

//
// NOTE: Because of the way this was originally designed with results
// and requests mashed together in same object, the result and obj here
// are the same object.
//
q.on("success", (obj: QueueThing, result: number) => {
    console.log(`job [${obj.id}] completed with result [${result}].`);
});

q.on("error", (obj: QueueThing, err: any) => {
    if (err.canceled) {
        console.log(`job [${obj.id}] was canceled.`);
    } else {
        console.log(`job [${obj.id}] failed with error [${err}].`);
    }
});

q.on("start", (obj: QueueThing) => {
    console.log(`job [${obj.id}] started.`);
});

q.push(makeJob(1, 1000));
q.push(makeJob(2, 2000, false, true));
q.push(
    makeJob(3, 1500, true, false, {
        reject: (err) => {
            console.log(
                `Also got rejection message [${err}] from optional reject.`
            );
        },
    })
);
q.push(makeJob(4, 5000));
q.push(
    makeJob(5, 2500, false, false, {
        resolve: (result: number) => {
            console.log(`Also got result [${result}] from optional resolve.`);
        },
    })
);
