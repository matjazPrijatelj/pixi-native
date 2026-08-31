export type FrameCallback = (timestamp: number) => void;

export interface FrameSchedulerOptions {
    readonly now?: () => number;
    readonly setTimer?: (callback: () => void, delayMS: number) => unknown;
    readonly clearTimer?: (timer: unknown) => void;
    readonly frameIntervalMS?: number;
}

/** Timer-backed requestAnimationFrame scheduler for the native Node runtime. */
export class FrameScheduler {
    private readonly callbacks = new Map<number, FrameCallback>();
    private readonly now: () => number;
    private readonly setTimer: (
        callback: () => void,
        delayMS: number,
    ) => unknown;
    private readonly clearTimer: (timer: unknown) => void;
    private readonly frameIntervalMS: number;
    private nextId = 1;
    private timer: unknown | undefined;
    private deadline: number;

    public constructor(options: FrameSchedulerOptions = {}) {
        this.now = options.now ?? (() => performance.now());
        this.setTimer =
            options.setTimer ??
            ((callback, delayMS) => setTimeout(callback, delayMS));
        this.clearTimer =
            options.clearTimer ??
            ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
        this.frameIntervalMS = options.frameIntervalMS ?? 1000 / 60;
        this.deadline = this.now();
    }

    public request(callback: FrameCallback): number {
        const id = this.nextId++;
        this.callbacks.set(id, callback);
        this.schedule();
        return id;
    }

    public cancel(id: number): void {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0 && this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
        }
    }

    private dispatch(): void {
        this.timer = undefined;
        const pending = [...this.callbacks.values()];
        this.callbacks.clear();
        const timestamp = this.now();

        for (const callback of pending) callback(timestamp);
        this.schedule();
    }

    private schedule(): void {
        if (this.callbacks.size === 0 || this.timer !== undefined) return;

        const currentTime = this.now();
        let nextDeadline = this.deadline + this.frameIntervalMS;

        if (nextDeadline <= currentTime) {
            const missedIntervals =
                Math.floor(
                    (currentTime - nextDeadline) / this.frameIntervalMS,
                ) + 1;
            nextDeadline += missedIntervals * this.frameIntervalMS;
            if (nextDeadline <= currentTime) {
                nextDeadline += this.frameIntervalMS;
            }
        }

        this.deadline = nextDeadline;
        this.timer = this.setTimer(
            () => this.dispatch(),
            Math.max(0, nextDeadline - currentTime),
        );
    }
}
