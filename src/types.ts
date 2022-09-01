export const CANCELED = "Canceled";
export const TIMEDOUT = "Timeout";
export const EVENT_STATUS = "status";

export enum QueueWorkerStatus {
    QUEUED,
    IN_PROGRESS,
    FINISHED,
    CANCELED,
    TIMEDOUT,
}

export type QueueWorkerOptions = {
    timeout?: number | undefined;
};

export type QueueOptions = {
    concurrency?: number;
    timeout?: number;
    autostart?: boolean;
};

export type QueueActivity<T> = {
    pending: T[];
    queued: T[];
};

//
// NOTE: PromiseLike allows you to use say Bluebird Promises with the queue, which are cancelable.
// Annoyingly, there are no catch or finally clauses so you have to use the "old" 2-param then() call.
//
export interface Runnable<T> {
    run(): PromiseLike<T>;
}

export class QueueWorker<T extends Runnable<R>, R> {
    private reject: ((reason?: any) => void) | null = null;
    private resolve: ((value: R | PromiseLike<R>) => void) | null = null;
    private runningPromise: PromiseLike<R> | null = null;
    public promise: Promise<R>;
    public timeoutId: any;
    private _timeout: number;

    constructor(
        public obj: T,
        options?: QueueWorkerOptions,
        defaultTimeout: number = 0
    ) {
        let timeout = options?.timeout;
        this._timeout =
            timeout === null || timeout === undefined
                ? defaultTimeout
                : timeout;

        //
        // Set up a promise immediately in case something wants to just be put in
        // waiting status right away when this job is created. It will get completed
        // once the job is started and finished.
        //
        this.promise = new Promise<R>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    run() {
        this.runningPromise = this.obj.run();

        this.runningPromise.then(
            (result) => {
                // if (this.options?.resolve) {
                //     this.options?.resolve(result);
                // }
                this.resolve?.(result);
                return result;
            },
            (err: any) => {
                this.reject?.(err);
            }
        );
        //
        // Return this jobs overall promise.
        //
        return this.promise;
    }

    get timeout() {
        return this._timeout;
    }

    timedout() {
        this.reject?.(new Error(TIMEDOUT));
    }

    cancel() {
        //
        // If run() returns a Bluebird promise we can call cancel on it.
        // If not, then we just reject it anyway and I guess the task goes
        // on running but we will ignore the result now.
        //
        // @ts-ignore
        if (this.runningPromise?.["cancel"]) {
            // @ts-ignore
            this.runningPromise["cancel"]();
        }
        // this.reject({ canceled: true });
        this.reject?.(new Error(CANCELED));
    }
}
