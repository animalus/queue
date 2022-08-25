//
// NOTE: This code was converted to typescript from the npm module "queue".
// I also removed stuff that I wasn't using and cleaned up some things I had issues with
// AND expanded it to allow the storage of the objects on the queue. The queue items (QueueWorkers)
// have an input and output type, T and R respectively. This allows you to see what objects
// are in the queue and to remove them if desired.
//
import { EventEmitter } from "events";

import { QueueActivity, QueueOptions, QueueWorker } from "./types";

//
// TODO: Replace EventEmitter with the native EventTarget (since node 15) so that it can be used in
// both Node and the browser? Actually, I'm not positive events module won't work in the browser but
// I do know there are native browser implementations of EventTarget as well. So switching to that
// will use native code in both and avoid this import and the import of @types/events.
//
export class Queue<K, T, R> extends EventEmitter {
    private concurrency: number = 1;
    private timeout: number = 0;
    private autostart: boolean = true;
    private session: number = 0;
    private running: boolean = false;

    private pending: QueueWorker<T, R>[] = [];
    private jobs: QueueWorker<T, R>[] = [];

    private timers: {} = {};

    constructor(private keyGetter: (T) => K, options: QueueOptions) {
        super();

        this.concurrency = options?.concurrency || 1;
        this.timeout = options?.timeout || 0;
        this.autostart =
            options.autostart === null || options.autostart === undefined
                ? true
                : options.autostart;
    }

    push(job: QueueWorker<T, R>) {
        const result = this.jobs.push(job);

        //
        // NOTE: emit this BEFORE start() method because that might immediately
        // emit a "start" event and we want to make sure that the queue event comes
        // before the start event.
        //
        this.emit("queued", job.obj, this.jobs.length);

        if (this.autostart) {
            this.start();
        }
        return result;
    }

    getActivity() {
        return {
            pending: [...this.pending.map((job) => job.obj)],
            queued: [...this.jobs.map((job) => job.obj)],
        } as QueueActivity<T>;
    }

    private isJob(key: K, job: QueueWorker<T, R>) {
        return this.keyGetter(job.obj) == key;
    }

    isQueued(key: K) {
        for (const job of this.jobs) {
            if (this.isJob(key, job)) {
                return true;
            }
        }
        return false;
    }

    cancel(key: K) {
        for (let ii = 0; ii < this.pending.length; ii++) {
            const job = this.pending[ii];
            if (this.isJob(key, job)) {
                this.pending.splice(ii, 1);

                //
                // Cass this after splicing the array so that the system can move
                // on to the next without worrying about waiting for a cancel to complete.
                //
                if (job.cancel) {
                    job.cancel();
                }
                return job.obj;
            }
        }

        for (let ii = 0; ii < this.jobs.length; ii++) {
            const job = this.jobs[ii];
            if (this.isJob(key, job)) {
                this.jobs.splice(ii, 1);
                return job.obj;
            }
        }

        return null;
    }

    start() {
        this.running = true;

        if (this.pending.length >= this.concurrency) {
            return;
        }

        if (this.jobs.length === 0) {
            if (this.pending.length === 0) {
                this.done();
            }
            return;
        }

        var job = this.jobs.shift();

        var once = true;
        var session = this.session;
        var timeoutId = null;
        var didTimeout = false;
        var timeout =
            job.timeout === null || job.timeout === undefined
                ? this.timeout
                : job.timeout;

        const next = (err?: any, result?: R) => {
            if (once && this.session === session) {
                once = false;
                this.pending.shift();
                if (timeoutId !== null) {
                    delete this.timers[timeoutId];
                    clearTimeout(timeoutId);
                }

                if (err) {
                    this.emit("error", job.obj, err);
                } else if (didTimeout === false) {
                    this.emit("success", job.obj, result);
                }

                if (this.session === session) {
                    if (this.pending.length === 0 && this.jobs.length === 0) {
                        this.done();
                    } else if (this.running) {
                        this.start();
                    }
                }
            }
        };

        if (timeout > 0) {
            timeoutId = setTimeout(() => {
                didTimeout = true;
                if (this.listeners("timeout").length > 0) {
                    this.emit("timeout", next, job.obj);
                } else {
                    next();
                }
            }, timeout);
            this.timers[timeoutId] = timeoutId;
        }

        this.pending.push(job);
        this.emit("start", job.obj);
        var promise = job.run();
        if (promise) {
            promise
                .then((result) => {
                    return next(null, result);
                })
                .catch((err) => {
                    return next(err || true);
                });
        }

        if (this.running && this.jobs.length > 0) {
            this.start();
        }
    }

    done(err?: any) {
        this.session++;
        this.running = false;
        this.emit("end", err);
    }

    stop() {
        this.running = false;
    }

    end(err: any) {
        for (var key in this.timers) {
            var timeoutId = this.timers[key];
            delete this.timers[key];
            clearTimeout(timeoutId);
        }
        this.jobs.length = 0;
        this.pending.length = 0;
        this.done(err);
    }
}
