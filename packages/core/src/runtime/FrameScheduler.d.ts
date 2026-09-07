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
    readonly minimumFrameSpacingRatio?: number;
}
/** Compositor-clock-backed requestAnimationFrame scheduler for Windows. */
export declare class VSyncFrameScheduler {
    private readonly callbacks;
    private readonly waitForPresent;
    private readonly now;
    private readonly setTimer;
    private readonly clearTimer;
    private readonly fallbackFrameIntervalMS;
    private readonly minimumFrameSpacingMS;
    private nextId;
    private waiting;
    private fallbackTimer;
    private disposed;
    private lastDispatchTime;
    constructor(options: VSyncFrameSchedulerOptions);
    request(callback: FrameCallback): number;
    cancel(id: number): void;
    /** Dispatches the current RAF batch from a native Windows modal loop. */
    dispatchNow(timestamp?: number): number;
    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    dispose(): void;
    private schedule;
    private dispatch;
    private dispatchCallbacks;
}
/** Timer-backed requestAnimationFrame scheduler for the native Node runtime. */
export declare class FrameScheduler {
    private readonly callbacks;
    private readonly now;
    private readonly setTimer;
    private readonly clearTimer;
    private readonly frameIntervalMS;
    private readonly earlyToleranceMS;
    private readonly minimumFrameSpacingRatio;
    private nextId;
    private timer;
    private deadline;
    private dispatching;
    private disposed;
    constructor(options?: FrameSchedulerOptions);
    request(callback: FrameCallback): number;
    cancel(id: number): void;
    /** Dispatches the current RAF batch from a native Windows modal loop. */
    dispatchNow(timestamp?: number): number;
    /** Stops scheduling and drops work that belongs to the disposed runtime. */
    dispose(): void;
    private dispatch;
    private schedule;
    private advanceDeadline;
    private dispatchCallbacks;
}
