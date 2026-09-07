import type { NodeNativeInput, NodeWindowHandle } from "../runtime/nativeTypes.ts";
type FrameCallback = (timestamp: number) => void;
type RequestFrame = (callback: FrameCallback) => number;
type CancelFrame = (requestId: number) => void;
type ManagedTicker = {
    add(callback: () => void, context?: unknown, priority?: number): unknown;
    remove(callback: () => void, context?: unknown): unknown;
    start(): void;
    stop(): void;
};
export interface ManagedRuntimeNative {
    readonly window: NodeWindowHandle;
    readonly input: NodeNativeInput;
    readonly device?: GPUDevice | null;
    readonly swap?: () => void;
    destroy(): void;
}
export interface ManagedNativeApplication<TApplication, TNative> {
    readonly app: TApplication;
    readonly native: TNative;
    readonly destroy: () => Promise<void>;
    readonly addDestroyListener: (listener: () => void | Promise<void>) => () => void;
}
export interface ManageNativeApplicationOptions<TApplication, TNative> {
    readonly app: TApplication & {
        readonly ticker: ManagedTicker;
    };
    readonly native: TNative & ManagedRuntimeNative;
    readonly present?: () => void;
    readonly destroyApplication: () => void | Promise<void>;
    /** @internal Test seam for the browser-like animation frame scheduler. */
    readonly requestFrame?: RequestFrame;
    /** @internal Test seam for the browser-like animation frame scheduler. */
    readonly cancelFrame?: CancelFrame;
}
/** Owns the browser-like runtime loop and native lifecycle around a Pixi app. */
export declare function manageNativeApplication<TApplication, TNative>(options: ManageNativeApplicationOptions<TApplication, TNative>): ManagedNativeApplication<TApplication, TNative>;
export {};
