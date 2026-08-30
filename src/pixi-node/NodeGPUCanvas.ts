import type { NodeWindowRenderer } from "./nativeTypes.ts";

/** Minimal HTMLCanvasElement-shaped surface for Pixi's WebGPU renderer. */
export class NodeGPUCanvas {
    public readonly style: Record<string, string> = {};
    public width: number;
    public height: number;

    private readonly renderer: NodeWindowRenderer;
    private readonly context: GPUCanvasContext;

    public constructor(renderer: NodeWindowRenderer, width = 1280, height = 720) {
        this.renderer = renderer;
        this.context = {
            configure: (): void => undefined,
            unconfigure: (): void => undefined,
            getCurrentTexture: (): GPUTexture => this.renderer.getCurrentTexture()
        } as unknown as GPUCanvasContext;
        this.width = width;
        this.height = height;
    }

    public get clientWidth(): number { return this.width; }
    public get clientHeight(): number { return this.height; }
    public getBoundingClientRect(): DOMRect {
        return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    public addEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | AddEventListenerOptions): void {}
    public removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject, _options?: boolean | EventListenerOptions): void {}
    public getContext(type: string): unknown {
        if (type !== "webgpu") return null;
        return this.context;
    }

    public resize(width: number, height: number): void {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.renderer.resize();
    }
}
