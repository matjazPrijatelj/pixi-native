import { DOMAdapter } from "pixi.js";
import type { GpuWindow } from "electrobun/main";
import { webgpu } from "electrobun/main";
import { ElectrobunTextCanvas } from "./ElectrobunTextCanvas.ts";

/** Minimal Pixi environment adapter for Electrobun's native WGPU runtime. */
export class ElectrobunDOMAdapter {
    public readonly isOffscreenCanvasSupported = false;

    public constructor(private readonly gpuWindow: GpuWindow) {}

    public createCanvas(width = 1, height = 1): HTMLCanvasElement {
        return new ElectrobunTextCanvas(width, height) as unknown as HTMLCanvasElement;
    }

    public getCanvasRenderingContext2D(): { prototype: object } {
        const context = new ElectrobunTextCanvas().getContext("2d") as object;
        const contextPrototype = Object.getPrototypeOf(context);
        class ContextConstructor {
            public constructor(canvas: ElectrobunTextCanvas) {
                return canvas.getContext("2d") as never;
            }
        }
        Object.setPrototypeOf(ContextConstructor.prototype, contextPrototype);
        return ContextConstructor as unknown as { prototype: object };
    }

    public getNavigator(): { userAgent: string; gpu: GPU | null } {
        return { userAgent: "Electrobun Native WGPU", gpu: webgpu.navigator };
    }

    public createImage(): never { throw new Error("Image loading is not implemented in the native WGPU PoC"); }
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
        const source = typeof (this.gpuWindow as any).onFrame === "function" ? "gtk" : "timer";
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
            if (source === "gtk") return;
            const now = performance.now();
            deadline = Math.max(deadline + 1000 / 60, now);
            const delay = Math.min(1000, Math.max(0, deadline - now));
            timer = setTimeout(() => dispatch(performance.now()), delay);
        };

        if (source === "gtk") {
            const onFrame = (this.gpuWindow as any).onFrame.bind(this.gpuWindow);
            onFrame((timestamp: number) => {
                if (callbacks.size) dispatch(timestamp);
            });
        }
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
        if (!globalThis.document) {
            const makeElement = (tagName: string) => {
                const element: any = {
                    tagName: tagName.toUpperCase(),
                    style: {},
                    children: [],
                    parentNode: null,
                    appendChild(child: any) { child.parentNode = element; element.children.push(child); return child; },
                    removeChild(child: any) { element.children = element.children.filter((item: any) => item !== child); child.parentNode = null; },
                    contains(child: any) { return element.children.includes(child); },
                    remove() { element.parentNode?.removeChild(element); },
                    addEventListener() {},
                    removeEventListener() {}
                };
                return element;
            };
            const body = makeElement("body");
            if (!(globalThis as any).requestAnimationFrame) {
                this.installFrameScheduler();
            }
            (globalThis as any).document = {
                baseURI: "file:///",
                body,
                createElement: makeElement,
                createElementNS: (_namespace: string, tagName: string) => makeElement(tagName),
                addEventListener() {},
                removeEventListener() {}
            };
        }
    }
}
