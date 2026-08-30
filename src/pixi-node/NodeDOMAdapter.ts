import { DOMAdapter } from "pixi.js";
import { fileURLToPath } from "node:url";
import type { NodeGPUInstance } from "./nativeTypes.ts";
import { NodeTextCanvas } from "./NodeTextCanvas.ts";
import { Canvas, Image as SkiaImage } from "skia-canvas";

class NodeImage extends SkiaImage {
    private pixelCanvas?: Canvas;
    public override get src(): string { return super.src; }
    public override set src(value: string | URL | Buffer) {
        const normalized = value instanceof URL
            ? (value.protocol === "file:" ? fileURLToPath(value) : value)
            : (typeof value === "string" && value.startsWith("file:") ? fileURLToPath(value) : value);
        this.pixelCanvas = undefined;
        super.src = normalized as never;
    }
    public getContext(type: string): unknown {
        if (type !== "2d") return null;
        if (!this.pixelCanvas) {
            this.pixelCanvas = new Canvas(Math.max(1, this.width), Math.max(1, this.height));
            this.pixelCanvas.getContext("2d").drawImage(this, 0, 0);
        }
        return this.pixelCanvas.getContext("2d");
    }
}

/** Minimal Pixi environment adapter for Node's native WGPU runtime. */
export class NodeDOMAdapter {
    public readonly isOffscreenCanvasSupported = false;

    private readonly gpu: NodeGPUInstance;

    public constructor(gpu: NodeGPUInstance) {
        this.gpu = gpu;
    }

    public createCanvas(width = 1, height = 1): HTMLCanvasElement {
        return new NodeTextCanvas(width, height) as unknown as HTMLCanvasElement;
    }

    public getCanvasRenderingContext2D(): { prototype: object } {
        const context = new NodeTextCanvas().getContext("2d") as object;
        const contextPrototype = Object.getPrototypeOf(context);
        class ContextConstructor {
            public constructor(canvas: NodeTextCanvas) {
                return canvas.getContext("2d") as never;
            }
        }
        Object.setPrototypeOf(ContextConstructor.prototype, contextPrototype);
        return ContextConstructor as unknown as { prototype: object };
    }

    public getNavigator(): { userAgent: string; gpu: NodeGPUInstance | null } {
        return { userAgent: "Node native WebGPU", gpu: this.gpu as unknown as GPU };
    }

    public createImage(): HTMLImageElement { return new NodeImage() as unknown as HTMLImageElement; }
    public getWebGLRenderingContext(): never { throw new Error("WebGL is intentionally unsupported in this PoC"); }
    public getBaseUrl(): string { return "file:///"; }
    public getFontFaceSet(): null { return null; }
    public fetch(url: RequestInfo, options?: RequestInit): Promise<Response> { return globalThis.fetch(url, options); }
    public parseXML(): never { throw new Error("XML parsing is not implemented in the native WGPU PoC"); }

    private installFrameScheduler(): void {
        type FrameCallback = (timestamp: number) => void;
        const callbacks = new Map<number, FrameCallback>();
        let nextId = 1;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let deadline = performance.now();
        const source = "timer";
        console.log({ animationFrameSource: source });

        const dispatch = (timestamp: number): void => {
            timer = undefined;
            const pending = [...callbacks.entries()];
            callbacks.clear();
            for (const [, callback] of pending) callback(timestamp);
            if (source === "timer") schedule();
        };
        const schedule = (): void => {
            if (!callbacks.size || timer !== undefined) return;
            const now = performance.now();
            deadline = Math.max(deadline + 1000 / 60, now);
            const delay = Math.min(1000, Math.max(0, deadline - now));
            timer = setTimeout(() => dispatch(performance.now()), delay);
        };
        (globalThis as any).requestAnimationFrame = (callback: FrameCallback): number => {
            const id = nextId++;
            callbacks.set(id, callback);
            schedule();
            return id;
        };
        (globalThis as any).cancelAnimationFrame = (id: number): void => {
            callbacks.delete(id);
            if (!callbacks.size && timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
    }

    public install(): void {
        const canvas2d = this.createCanvas().getContext("2d");
        if (!canvas2d) throw new Error("Skia Canvas2D backend is unavailable");
        DOMAdapter.set(this as never);
        const globalObject = globalThis as any;
        if (!globalObject.HTMLCanvasElement) globalObject.HTMLCanvasElement = NodeTextCanvas;
        const globals: Record<string, Record<string, number>> = {
            GPUTextureUsage: { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 },
            GPUBufferUsage: { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 },
            GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
            GPUMapMode: { READ: 1, WRITE: 2 },
            GPUColorWrite: { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 }
        };
        for (const [name, value] of Object.entries(globals)) {
            if (!(globalThis as any)[name]) (globalThis as any)[name] = value;
        }
        if (!(globalThis as any).addEventListener) {
            (globalThis as any).addEventListener = (): void => undefined;
            (globalThis as any).removeEventListener = (): void => undefined;
        }
        if (!globalThis.document) {
            const makeElement = (tagName: string): Record<string, unknown> => {
                const element: Record<string, unknown> = {
                    tagName: tagName.toUpperCase(),
                    style: {},
                    children: [],
                    parentNode: null,
                    appendChild(child: Record<string, unknown>) {
                        child.parentNode = element;
                        (element.children as Record<string, unknown>[]).push(child);
                        return child;
                    },
                    removeChild(child: Record<string, unknown>) {
                        element.children = (element.children as Record<string, unknown>[]).filter((item) => item !== child);
                        child.parentNode = null;
                    },
                    contains(child: Record<string, unknown>) { return (element.children as Record<string, unknown>[]).includes(child); },
                    remove() { (element.parentNode as { removeChild?: (child: Record<string, unknown>) => void } | null)?.removeChild?.(element); },
                    addEventListener() {},
                    removeEventListener() {},
                    canPlayType() { return ""; }
                };
                return element;
            };
            (globalThis as any).document = {
                baseURI: "file:///",
                createElement: makeElement,
                createElementNS: (_namespace: string, tagName: string) => makeElement(tagName),
                addEventListener() {},
                removeEventListener() {}
            };
        }
        if (!globalThis.requestAnimationFrame) this.installFrameScheduler();
    }
}
