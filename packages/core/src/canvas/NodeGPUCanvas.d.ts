import type { NodeWindowRenderer } from "../runtime/nativeTypes.ts";
/** Minimal HTMLCanvasElement-shaped surface for Pixi's WebGPU renderer. */
export declare class NodeGPUCanvas {
    readonly style: Record<string, string>;
    width: number;
    height: number;
    private readonly renderer;
    private readonly context;
    private readonly listeners;
    constructor(renderer: NodeWindowRenderer, width?: number, height?: number);
    get clientWidth(): number;
    get clientHeight(): number;
    getBoundingClientRect(): DOMRect;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, _options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, _options?: boolean | EventListenerOptions): void;
    /** Delivers an SDL-translated event to Pixi's DOM event listeners. */
    dispatchNativeEvent(type: string, event: Event): void;
    getContext(type: string): unknown;
    resize(width: number, height: number): void;
}
