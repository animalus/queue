import { Queue } from "../src/queue";
import { EVENT_STATUS, QueueWorkerStatus, Runnable } from "../src/types";

class FakeJob implements Runnable<number> {
    timer: any;

    constructor(
        public id: number,
        private duration: number,
        private error: boolean = false
    ) {}

    run(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            if (this.error) {
                this.timer = setTimeout(() => {
                    reject("Something bad has happened.");
                }, 100);
            } else {
                this.timer = setTimeout(() => {
                    resolve(this.id * this.id);
                }, this.duration);
            }
        }).finally(() => {
            clearTimeout(this.timer);
        });
    }
}

const queue = new Queue((obj: FakeJob) => obj.id, {
    timeout: 3000,
    concurrency: process.argv.length > 2 ? parseInt(process.argv[2]) : 2,
});

queue.on(
    EVENT_STATUS,
    (status: QueueWorkerStatus, obj: FakeJob, result: number, err: any) => {
        switch (status) {
            case QueueWorkerStatus.QUEUED:
                console.log(`job [${obj.id}] was queued.`);
                break;
            case QueueWorkerStatus.CANCELED:
                console.log(`job [${obj.id}] was canceled.`);
                break;
            case QueueWorkerStatus.FINISHED:
                if (err) {
                    console.log(`job [${obj.id}] failed with error [${err}].`);
                } else {
                    console.log(
                        `job [${obj.id}] completed with result [${result}].`
                    );
                }
                break;
            case QueueWorkerStatus.IN_PROGRESS:
                console.log(`job [${obj.id}] started.`);
                break;
            case QueueWorkerStatus.TIMEDOUT:
                console.log(`job [${obj.id}] timed out.`);
                break;
        }
    }
);

queue.push(new FakeJob(1, 1000));
queue.push(new FakeJob(2, 4000));
queue.push(new FakeJob(3, 1500, true));
queue.push(new FakeJob(4, 5000));
queue.push(new FakeJob(5, 2500));
queue.push(new FakeJob(6, 4000));

//
// Test canceling while running.
//
setTimeout(() => {
    queue.cancel(2);
}, 1500);

//
// Test canceling while simply queued.
//
queue.cancel(6);
