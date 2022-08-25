export type QueueWorkerOptions<R> = {
    timeout?: number;
    resolve?: (value: R | PromiseLike<R>) => void;
    reject?: (reason?: any) => void;
    cancel?: () => void;
};

export interface QueueWorker<T, R> {
    timeout: number;
    obj: T;
    run(): Promise<R>;
    cancel?(): void;
}

export abstract class AbstractQueueWorker<T, R> implements QueueWorker<T, R> {
    private reject: (reason?: any) => void;
    private promise: Promise<R>;

    constructor(public obj: T, private options?: QueueWorkerOptions<R>) {}

    abstract doWork(): Promise<R>;

    run(): Promise<R> {
        const promise = new Promise<R>((resolve, reject) => {
            this.reject = reject;

            //
            // NOTE: If you use Bluebird promises they are cancelable. i.e. they have
            // a cancel() method on them and then you can react to onCancel() and say kill
            // a shelled process or whatever. But they leave the Promise unresolved and unrejected.
            // I don't like that so I reject the promise in that case here with a flag to indicate
            // that is why it was rejected.
            //
            this.promise = this.doWork()
                .then((result) => {
                    if (this.options?.resolve) {
                        this.options?.resolve(result);
                    }
                    resolve(result);
                    return result;
                })
                .catch((err) => {
                    this.callReject(err);
                    return null;
                });
        });

        return promise;
    }

    get timeout() {
        return this.options?.timeout;
    }

    private callReject(err?: any) {
        if (this.options?.reject) {
            this.options?.reject(err);
        }
        this.reject(err);
    }

    cancel() {
        if (this.options?.cancel) {
            this.options.cancel();
        }
        if (this.promise && this.promise["cancel"]) {
            this.promise["cancel"]();
        }
        this.callReject({ canceled: true });
    }
}

export type QueueOptions = {
    concurrency?: number;
    timeout?: number;
    autostart?: boolean;
};

export type QueueActivity<T> = {
    pending: T[];
    queued: T[];
};
