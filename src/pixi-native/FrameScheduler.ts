export type FrameCallback = (timestamp: number) => void;

export interface FrameSchedulerOptions {
    readonly now?: () => number;
    readonly setTimer?: (callback: () => void, delayMS: number) => unknown;
    readonly clearTimer?: (timer: unknown) => void;
    readonly frameIntervalMS?: number;
    readonly earlyToleranceMS?: number;
    readonly minimumFrameSpacingRatio?: number;
}

export interface VSyncFrameSchedulerOptions {
    readonly waitForPresent: () => Promise<boolean>;
    readonly now?: () => number;
    readonly setTimer?: (callback: () => void, delayMS: number) => unknown;
    readonly clearTimer?: (timer: unknown) => void;
    readonly fallbackFrameIntervalMS?: number;
}

/** Present-signal-backed requestAnimationFrame scheduler for Windows DXGI. */
export class VSyncFrameScheduler {
    private readonly callbacks = new Map<number, FrameCallback>();
    private readonly waitForPresent: () => Promise<boolean>;
    private readonly now: () => number;
    private readonly setTimer: (
        callback: () => void,
        delayMS: number,
    ) => unknown;
    private readonly clearTimer: (timer: unknown) => void;
    private readonly fallbackFrameIntervalMS: number;
    private nextId = 1;
    private waiting = false;
    private fallbackTimer: unknown | undefined;
    private disposed = false;

    public constructor(options: VSyncFrameSchedulerOptions) {
        this.waitForPresent = options.waitForPresent;
        this.now = options.now ?? (() => performance.now());
        this.setTimer =
            options.setTimer ??
            ((callback, delayMS) => setTimeout(callback, delayMS));
        this.clearTimer =
            options.clearTimer ??
            ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
        this.fallbackFrameIntervalMS =
            options.fallbackFrameIntervalMS ?? 1000 / 60;
        if (
            !Number.isFinite(this.fallbackFrameIntervalMS) ||
            this.fallbackFrameIntervalMS <= 0
        ) {
            throw new Error("Fallback frame interval must be positive and finite");
        }
    }

    public request(callback: FrameCallback): number {
        const id = this.nextId++;
        if (this.disposed) return id;
        this.callbacks.set(id, callback);
        this.schedule();
        return id;
    }

    public cancel(id: number): void {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0 && this.fallbackTimer !== undefined) {
            this.clearTimer(this.fallbackTimer);
            this.fallbackTimer = undefined;
        }
    }

    /** Dispatches the current RAF batch from a native Windows modal loop. */
    public dispatchNow(timestamp = this.now()): number {
        if (this.disposed) return 0;
        return this.dispatchCallbacks(timestamp);
    }

    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.callbacks.clear();
        this.waiting = false;
        if (this.fallbackTimer !== undefined) {
            this.clearTimer(this.fallbackTimer);
            this.fallbackTimer = undefined;
        }
    }

    private schedule(): void {
        if (
            this.waiting ||
            this.fallbackTimer !== undefined ||
            this.callbacks.size === 0
        ) return;
        this.waiting = true;
        void this.waitForPresent().then(
            (signaled) => this.dispatch(signaled),
            () => this.dispatch(false),
        );
    }

    private dispatch(signaled: boolean): void {
        this.waiting = false;
        if (this.disposed) return;
        if (!signaled) {
            if (this.callbacks.size === 0) return;
            this.fallbackTimer = this.setTimer(() => {
                this.fallbackTimer = undefined;
                this.dispatch(true);
            }, this.fallbackFrameIntervalMS);
            return;
        }

        this.dispatchCallbacks(this.now());
    }

    private dispatchCallbacks(timestamp: number): number {
        const pending = [...this.callbacks.values()];
        this.callbacks.clear();
        for (const callback of pending) {
            if (this.disposed) break;
            callback(timestamp);
        }
        this.schedule();
        return pending.length;
    }
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
    private readonly earlyToleranceMS: number;
    private readonly minimumFrameSpacingRatio: number;
    private nextId = 1;
    private timer: unknown | undefined;
    private deadline: number | undefined;
    private dispatching = false;
    private disposed = false;

    public constructor(options: FrameSchedulerOptions = {}) {
        this.now = options.now ?? (() => performance.now());
        this.setTimer =
            options.setTimer ??
            ((callback, delayMS) => setTimeout(callback, delayMS));
        this.clearTimer =
            options.clearTimer ??
            ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
        this.frameIntervalMS = options.frameIntervalMS ?? 1000 / 60;
        if (!Number.isFinite(this.frameIntervalMS) || this.frameIntervalMS <= 0) {
            throw new Error("Frame interval must be positive and finite");
        }
        this.earlyToleranceMS = options.earlyToleranceMS ?? 0.1;
        if (!Number.isFinite(this.earlyToleranceMS) || this.earlyToleranceMS < 0) {
            throw new Error("Early tolerance must be non-negative and finite");
        }
        this.minimumFrameSpacingRatio =
            options.minimumFrameSpacingRatio ?? 0.95;
        if (
            !Number.isFinite(this.minimumFrameSpacingRatio) ||
            this.minimumFrameSpacingRatio < 0 ||
            this.minimumFrameSpacingRatio > 1
        ) {
            throw new Error("Minimum frame spacing ratio must be between 0 and 1");
        }
    }

    public request(callback: FrameCallback): number {
        const id = this.nextId++;
        if (this.disposed) return id;
        const wasIdle =
            this.callbacks.size === 0 &&
            this.timer === undefined &&
            !this.dispatching;
        this.callbacks.set(id, callback);
        if (wasIdle) this.deadline = this.now() + this.frameIntervalMS;
        this.schedule();
        return id;
    }

    public cancel(id: number): void {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0 && this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
            this.deadline = undefined;
        }
    }

    /** Dispatches the current RAF batch from a native Windows modal loop. */
    public dispatchNow(timestamp = this.now()): number {
        if (this.disposed) return 0;
        if (this.timer !== undefined) this.clearTimer(this.timer);
        this.timer = undefined;
        if (this.callbacks.size === 0) {
            this.deadline = undefined;
            return 0;
        }
        this.deadline = timestamp;
        return this.dispatchCallbacks(timestamp);
    }

    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.callbacks.clear();
        this.deadline = undefined;
        if (this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
        }
    }

    private dispatch(): void {
        this.timer = undefined;
        if (this.disposed) return;
        const timestamp = this.now();
        if (
            this.deadline !== undefined &&
            timestamp + this.earlyToleranceMS < this.deadline
        ) {
            this.schedule();
            return;
        }

        this.dispatchCallbacks(timestamp);
    }

    private schedule(): void {
        if (this.callbacks.size === 0 || this.timer !== undefined) return;

        const currentTime = this.now();
        this.deadline ??= currentTime + this.frameIntervalMS;
        this.timer = this.setTimer(
            () => this.dispatch(),
            Math.max(0, this.deadline - currentTime),
        );
    }

    private advanceDeadline(timestamp: number): void {
        let deadline = (this.deadline ?? timestamp) + this.frameIntervalMS;
        if (deadline <= timestamp) {
            const missedIntervals =
                Math.floor((timestamp - deadline) / this.frameIntervalMS) + 1;
            deadline += missedIntervals * this.frameIntervalMS;
        }
        const minimumDeadline =
            timestamp + this.frameIntervalMS * this.minimumFrameSpacingRatio;
        this.deadline = Math.max(deadline, minimumDeadline);
    }

    private dispatchCallbacks(timestamp: number): number {
        const pending = [...this.callbacks.values()];
        this.callbacks.clear();
        this.advanceDeadline(timestamp);

        this.dispatching = true;
        try {
            for (const callback of pending) {
                if (this.disposed) break;
                callback(timestamp);
            }
        } finally {
            this.dispatching = false;
            this.schedule();
        }
        return pending.length;
    }
}
