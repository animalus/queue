import { EventEmitter } from "events";

import {
    CANCELED,
    EVENT_STATUS,
    QueueActivity,
    QueueOptions,
    QueueWorker,
    QueueWorkerOptions,
    QueueWorkerStatus,
    Runnable,
} from "./types";

export class Queue<K, T extends Runnable<R>, R> extends EventEmitter {
    private concurrency: number = 1;
    private timeout: number = 0;
    private running: boolean = false;

    private pending: Map<K, QueueWorker<T, R>> = new Map();
    private queued: Set<K> = new Set();
    private jobs: QueueWorker<T, R>[] = [];

    private timers = new Set<any>();

    constructor(private keyGetter: (value: T) => K, options: QueueOptions) {
        super();

        this.concurrency = options?.concurrency || 1;
        this.timeout = options?.timeout || 0;
        this.running =
            options.autostart === null || options.autostart === undefined
                ? true
                : options.autostart;
    }

    public pushp(obj: T, options?: QueueWorkerOptions) {
        const job = new QueueWorker<T, R>(obj, options, this.timeout);

        this.jobs.push(job);
        this.queued.add(this.getKey(obj));

        //
        // NOTE: emit this BEFORE next() method because that might immediately
        // emit a "start" event and we want to make sure that the queue event comes
        // before the start event.
        //
        this.emit(EVENT_STATUS, QueueWorkerStatus.QUEUED, job.obj);

        this._next();

        return job.promise;
    }

    public push(obj: T, options?: QueueWorkerOptions) {
        this.pushp(obj, options).catch((err: any) => {
            //
            // Here to catch the exception and avoid the uncaught exception error that
            // might result. But also we need to check to see if we are here because
            // an unstarted queued job was canceled and announce that.
            //
            if (
                !this.pending.has(this.getKey(obj)) &&
                err?.message === CANCELED
            ) {
                this.emit(EVENT_STATUS, QueueWorkerStatus.CANCELED, obj);
            }
        });
    }

    getActivity<M>(mapper: (value: T) => M) {
        const activity = this.activity;
        return {
            pending: activity.pending.map(mapper),
            queued: activity.queued.map(mapper),
        } as QueueActivity<M>;
    }

    get activity() {
        return {
            pending:
                this.pending.size > 0
                    ? Array.from(this.pending.values()).map((job) => job.obj)
                    : [],
            queued: this.jobs.map((job) => job.obj),
        } as QueueActivity<T>;
    }

    private getKey(obj: T) {
        return this.keyGetter(obj);
    }

    private isJob(key: K, job: QueueWorker<T, R>) {
        return this.getKey(job.obj) === key;
    }

    has(key: K) {
        return this.queued.has(key);
    }

    cancel(key: K) {
        //
        // Look for job in pending ...
        //
        const job = this.pending.get(key);
        if (job) {
            job.cancel();
            return job.obj;
        }

        //
        // Now look in queued.
        //
        for (let ii = 0; ii < this.jobs.length; ii++) {
            const job = this.jobs[ii];
            if (this.isJob(key, job)) {
                this.jobs.splice(ii, 1);
                this.queued.delete(key);
                job.cancel();
                return job.obj;
            }
        }

        return null;
    }

    private _finished(key: K, timeoutId: any) {
        this.pending.delete(key);
        this.queued.delete(key);
        this.timers.delete(timeoutId);
        clearTimeout(timeoutId);
    }

    start() {
        this.running = true;
        this._next();
    }

    private _next() {
        if (!this.running || this.pending.size >= this.concurrency) {
            return;
        }
        const job = this.jobs.shift();
        if (!job) {
            return;
        }

        const key = this.getKey(job.obj);
        this.pending.set(key, job);

        if (job.timeout > 0) {
            job.timeoutId = setTimeout(() => {
                //
                // In case this timeout didn't get canceled upon completion or error
                // let's check to make sure we don't accidentally call a timeout on it as well.
                // We do this by checking to see if this job is still pending.
                //
                if (this.pending.has(key)) {
                    this._finished(key, job.timeoutId);
                    this.emit(
                        EVENT_STATUS,
                        QueueWorkerStatus.TIMEDOUT,
                        job.obj
                    );
                    this._next();
                    // } else {
                    //     console.log(
                    //         "Could not finding pending.",
                    //         key,
                    //         this.pending
                    //     );
                }
            }, job.timeout);
            this.timers.add(job.timeoutId);
        }

        this.emit(EVENT_STATUS, QueueWorkerStatus.IN_PROGRESS, job.obj);

        job.run()
            .then((result) => {
                if (this.pending.has(key)) {
                    this._finished(key, job.timeoutId);
                    this.emit(
                        EVENT_STATUS,
                        QueueWorkerStatus.FINISHED,
                        job.obj,
                        result
                    );
                }
            })
            .catch((err) => {
                if (this.pending.has(key)) {
                    this._finished(key, job.timeoutId);
                    if (err?.message === CANCELED) {
                        this.emit(
                            EVENT_STATUS,
                            QueueWorkerStatus.CANCELED,
                            job.obj
                        );
                    } else {
                        this.emit(
                            EVENT_STATUS,
                            QueueWorkerStatus.FINISHED,
                            job.obj,
                            null,
                            err
                        );
                    }
                }
            })
            .finally(() => {
                this._next();
            });

        //
        // Basically for when we start and we need to build up to the number of concurrent
        // jobs running simultaneously. This will automatically stop running the next job
        // once concurrency is hit.
        //
        this._next();
    }

    stop() {
        this.running = false;
    }
}
