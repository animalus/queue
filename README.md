# queue

I started this from the source code of [queue](https://www.npmjs.com/package/queue) but it took a radical departure from that in the end. Mainly I needed to have access to the items in my queue by a key and to be able to cancel the jobs. So this rewrite allowed me to do that.

There are also no 3rd-party dependencies here outside of the devDependencies.

## Example/Test

`npm run example`

See `example/index.ts`.

```ts
import {
    EVENT_STATUS,
    Queue,
    QueueWorkerStatus,
    Runnable,
} from "@animalus/queue";

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
```

## Install

`npm i @animalus/queue`

_Note_: You may need to install the [`events`](https://github.com/Gozala/events) dependency if
your environment does not have it by default (eg. browser, react-native).

## API

### constructor

```ts
type QueueOptions = {
    concurrency?: number;
    timeout?: number;
    autostart?: boolean;
};

const queue = new Queue(keyGetter: (value: T) => K, options?: QueueOptions);
```

-   keyGetter is a function that tells the queue how to extract the key from the object in the queue, most likely a unique string or number.
-   concurrency: defaults to 1, meaning run the jobs serially.
-   timeout: defaults to 0, meaning don't timeout any job
-   autostart: defalts to true, meaning as soon as the first item is pushed on to the queue it is immediately started.

### `start()`

starts the queue jobs running (needed if autostart = false)

### `stop()`

Stops the queue. can be resumed with `start()`.

### `push(obj: T, options?: QueueWorkerOptions)`

pushes a job on to the queue. Can alternately override the queue's timeout with a different timeout for this one task. The object type T must implement the Runnable<R> interface. i.e. Class T has method run() that returns result of type R.

```ts
export type QueueWorkerOptions = {
    timeout?: number | undefined;
};

export interface Runnable<T> {
    run(): PromiseLike<T>;
}
```

### `pushp(obj: T, options?: QueueWorkerOptions): Promise<R>`

A push method that will return the internal promise of the QueueWoorker that resolves with the results if the task completes, and is rejected if it errors or if it was canceled from the queue.

### `has(key: K)`

Method to see if a particular key is in the queue

### `cancel(key: K)`

Method to cancel a job in the queue. This triggers a reject on the promise with an Error with message 'Canceled'. In addition, if your run() method returns a Bluebird promise it will call the cancel method on that promise.

### `on("status", status: QueueWorkerStatus, obj: T, result: R, err: any)`

You can listen for when the status of each item in the queue is altered. Every object goes through the cycle of the following events...

```ts
export enum QueueWorkerStatus {
    QUEUED,
    IN_PROGRESS,
    FINISHED,
    CANCELED,
    TIMEDOUT,
}
```

Upon `push()` the `QUEUED` status is immediately called. Once a particular job is started it goes into `IN_PROGRESS` status, followed by `FINISHED` when completed (with either a result or an error). Other statuses that get updated in the `"event"` listener are upon `CANCELED` and `TIMEDOUT`.

### `activity()`

Returns the currently running and queued jobs.

```ts
export type QueueActivity<T> = {
    pending: T[];
    queued: T[];
};
```

## License

Copyright © 2022 Animal.us<ken@happywhale.com>

This work is free. You can redistribute it and/or modify it under the
terms of the [MIT License](https://opensource.org/licenses/MIT).
See LICENSE for full details.
