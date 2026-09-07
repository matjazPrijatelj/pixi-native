import type { NodeGPUInstance } from "./nativeTypes.ts";
type NativeImageConstructor = new () => {
    src: string;
};
type NativeWebGLRenderingContextConstructor = {
    prototype: object;
};
type Pixi8DomAdapterRegistry = {
    set(adapter: unknown): void;
};
export interface NativeMouseEventData {
    readonly type: string;
    readonly clientX: number;
    readonly clientY: number;
    readonly button: number;
    readonly buttons: number;
    readonly movementX?: number;
    readonly movementY?: number;
    readonly deltaX?: number;
    readonly deltaY?: number;
}
export declare function createNativeMouseEvent(data: NativeMouseEventData): Event;
export interface NativeKeyboardEventData {
    readonly type: "keydown" | "keyup";
    readonly key: string;
    readonly code: string;
    readonly repeat?: boolean;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly altKey?: boolean;
    readonly metaKey?: boolean;
}
export declare function createNativeKeyboardEvent(data: NativeKeyboardEventData): Event;
/** Minimal Pixi environment adapter for Node's native WGPU runtime. */
export declare class NodeDOMAdapter {
    readonly isOffscreenCanvasSupported = false;
    private readonly gpu;
    private readonly webglContext;
    private readonly frameRateHz;
    private readonly waitForPresent?;
    private readonly imageConstructor;
    private readonly webglRenderingContextConstructor?;
    private usePixi7CanvasAdapter;
    private frameScheduler?;
    private readonly globalListeners;
    constructor(gpu: NodeGPUInstance | null, frameRateHz?: number, waitForPresent?: () => Promise<boolean>, webglContext?: unknown, imageConstructor?: NativeImageConstructor, webglRenderingContextConstructor?: NativeWebGLRenderingContextConstructor);
    createCanvas(width?: number, height?: number): HTMLCanvasElement;
    getCanvasRenderingContext2D(): {
        prototype: object;
    };
    getNavigator(): {
        userAgent: string;
        gpu: NodeGPUInstance | null;
    };
    createImage(): HTMLImageElement;
    getWebGLRenderingContext(): {
        prototype: object;
    };
    getBaseUrl(): string;
    getFontFaceSet(): null;
    fetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response>;
    parseXML(): never;
    private installFrameScheduler;
    /** Runs every pending RAF consumer while Windows owns the modal move/resize loop. */
    dispatchModalFrame(timestamp?: number): number;
    /** Releases frame and event work owned by this native runtime. */
    dispose(): void;
    /** Delivers SDL-translated events registered on document/window globals. */
    dispatchGlobalEvent(type: string, event: Event): void;
    private installEnvironment;
    /** Installs this adapter through Pixi 8's DOM adapter registry. */
    installPixi8(registry: Pixi8DomAdapterRegistry): void;
    /** Installs this adapter for Pixi 7's settings-based environment API. */
    installPixi7(settings: {
        ADAPTER: unknown;
    }): void;
    /** Adds the DOM operations used by Pixi 7 when another native document exists. */
    private patchPixi7Document;
    private createPixi7Element;
}
export declare function normalizeRefreshRate(refreshRateHz: number): number;
export {};
