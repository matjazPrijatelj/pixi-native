/** Compositor-clock-backed requestAnimationFrame scheduler for Windows. */
export class VSyncFrameScheduler {
    callbacks = new Map();
    waitForPresent;
    now;
    setTimer;
    clearTimer;
    fallbackFrameIntervalMS;
    minimumFrameSpacingMS;
    nextId = 1;
    waiting = false;
    fallbackTimer;
    disposed = false;
    lastDispatchTime;
    constructor(options) {
        this.waitForPresent = options.waitForPresent;
        this.now = options.now ?? (() => performance.now());
        this.setTimer =
            options.setTimer ??
                ((callback, delayMS) => setTimeout(callback, delayMS));
        this.clearTimer =
            options.clearTimer ??
                ((timer) => clearTimeout(timer));
        this.fallbackFrameIntervalMS =
            options.fallbackFrameIntervalMS ?? 1000 / 60;
        if (!Number.isFinite(this.fallbackFrameIntervalMS) ||
            this.fallbackFrameIntervalMS <= 0) {
            throw new Error("Fallback frame interval must be positive and finite");
        }
        const minimumFrameSpacingRatio = options.minimumFrameSpacingRatio ?? 0.95;
        if (!Number.isFinite(minimumFrameSpacingRatio) ||
            minimumFrameSpacingRatio < 0 ||
            minimumFrameSpacingRatio > 1) {
            throw new Error("Minimum frame spacing ratio must be between 0 and 1");
        }
        this.minimumFrameSpacingMS =
            this.fallbackFrameIntervalMS * minimumFrameSpacingRatio;
    }
    request(callback) {
        const id = this.nextId++;
        if (this.disposed)
            return id;
        this.callbacks.set(id, callback);
        this.schedule();
        return id;
    }
    cancel(id) {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0 && this.fallbackTimer !== undefined) {
            this.clearTimer(this.fallbackTimer);
            this.fallbackTimer = undefined;
        }
    }
    /** Dispatches the current RAF batch from a native Windows modal loop. */
    dispatchNow(timestamp = this.now()) {
        if (this.disposed)
            return 0;
        return this.dispatchCallbacks(timestamp);
    }
    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.callbacks.clear();
        this.waiting = false;
        if (this.fallbackTimer !== undefined) {
            this.clearTimer(this.fallbackTimer);
            this.fallbackTimer = undefined;
        }
    }
    schedule() {
        if (this.waiting ||
            this.fallbackTimer !== undefined ||
            this.callbacks.size === 0)
            return;
        this.waiting = true;
        void this.waitForPresent().then((signaled) => this.dispatch(signaled), () => this.dispatch(false));
    }
    dispatch(signaled) {
        this.waiting = false;
        if (this.disposed)
            return;
        if (!signaled) {
            if (this.callbacks.size === 0)
                return;
            this.fallbackTimer = this.setTimer(() => {
                this.fallbackTimer = undefined;
                this.dispatch(true);
            }, this.fallbackFrameIntervalMS);
            return;
        }
        const timestamp = this.now();
        const elapsed = this.lastDispatchTime === undefined
            ? this.minimumFrameSpacingMS
            : timestamp - this.lastDispatchTime;
        if (elapsed < this.minimumFrameSpacingMS) {
            this.fallbackTimer = this.setTimer(() => {
                this.fallbackTimer = undefined;
                this.dispatch(true);
            }, this.minimumFrameSpacingMS - elapsed);
            return;
        }
        this.dispatchCallbacks(timestamp);
    }
    dispatchCallbacks(timestamp) {
        const pending = [...this.callbacks.values()];
        this.callbacks.clear();
        if (pending.length > 0)
            this.lastDispatchTime = timestamp;
        for (const callback of pending) {
            if (this.disposed)
                break;
            callback(timestamp);
        }
        this.schedule();
        return pending.length;
    }
}
/** Timer-backed requestAnimationFrame scheduler for the native Node runtime. */
export class FrameScheduler {
    callbacks = new Map();
    now;
    setTimer;
    clearTimer;
    frameIntervalMS;
    earlyToleranceMS;
    minimumFrameSpacingRatio;
    nextId = 1;
    timer;
    deadline;
    dispatching = false;
    disposed = false;
    constructor(options = {}) {
        this.now = options.now ?? (() => performance.now());
        this.setTimer =
            options.setTimer ??
                ((callback, delayMS) => setTimeout(callback, delayMS));
        this.clearTimer =
            options.clearTimer ??
                ((timer) => clearTimeout(timer));
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
        if (!Number.isFinite(this.minimumFrameSpacingRatio) ||
            this.minimumFrameSpacingRatio < 0 ||
            this.minimumFrameSpacingRatio > 1) {
            throw new Error("Minimum frame spacing ratio must be between 0 and 1");
        }
    }
    request(callback) {
        const id = this.nextId++;
        if (this.disposed)
            return id;
        const wasIdle = this.callbacks.size === 0 &&
            this.timer === undefined &&
            !this.dispatching;
        this.callbacks.set(id, callback);
        if (wasIdle)
            this.deadline = this.now() + this.frameIntervalMS;
        this.schedule();
        return id;
    }
    cancel(id) {
        this.callbacks.delete(id);
        if (this.callbacks.size === 0 && this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
            this.deadline = undefined;
        }
    }
    /** Dispatches the current RAF batch from a native Windows modal loop. */
    dispatchNow(timestamp = this.now()) {
        if (this.disposed)
            return 0;
        if (this.timer !== undefined)
            this.clearTimer(this.timer);
        this.timer = undefined;
        if (this.callbacks.size === 0) {
            this.deadline = undefined;
            return 0;
        }
        this.deadline = timestamp;
        return this.dispatchCallbacks(timestamp);
    }
    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.callbacks.clear();
        this.deadline = undefined;
        if (this.timer !== undefined) {
            this.clearTimer(this.timer);
            this.timer = undefined;
        }
    }
    dispatch() {
        this.timer = undefined;
        if (this.disposed)
            return;
        const timestamp = this.now();
        if (this.deadline !== undefined &&
            timestamp + this.earlyToleranceMS < this.deadline) {
            this.schedule();
            return;
        }
        this.dispatchCallbacks(timestamp);
    }
    schedule() {
        if (this.callbacks.size === 0 || this.timer !== undefined)
            return;
        const currentTime = this.now();
        this.deadline ??= currentTime + this.frameIntervalMS;
        this.timer = this.setTimer(() => this.dispatch(), Math.max(0, this.deadline - currentTime));
    }
    advanceDeadline(timestamp) {
        let deadline = (this.deadline ?? timestamp) + this.frameIntervalMS;
        if (deadline <= timestamp) {
            const missedIntervals = Math.floor((timestamp - deadline) / this.frameIntervalMS) + 1;
            deadline += missedIntervals * this.frameIntervalMS;
        }
        const minimumDeadline = timestamp + this.frameIntervalMS * this.minimumFrameSpacingRatio;
        this.deadline = Math.max(deadline, minimumDeadline);
    }
    dispatchCallbacks(timestamp) {
        const pending = [...this.callbacks.values()];
        this.callbacks.clear();
        this.advanceDeadline(timestamp);
        this.dispatching = true;
        try {
            for (const callback of pending) {
                if (this.disposed)
                    break;
                callback(timestamp);
            }
        }
        finally {
            this.dispatching = false;
            this.schedule();
        }
        return pending.length;
    }
}
