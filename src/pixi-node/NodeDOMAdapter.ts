import { DOMAdapter } from "pixi.js";
import { Image } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeGPUInstance } from "./nativeTypes.ts";
import { NodeCanvas } from "./NodeCanvas.ts";
import { FrameScheduler, VSyncFrameScheduler } from "./FrameScheduler.ts";

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

export function createNativeMouseEvent(data: NativeMouseEventData): Event {
    return {
        ...data,
        pageX: data.clientX,
        pageY: data.clientY,
        offsetX: data.clientX,
        offsetY: data.clientY,
        screenX: data.clientX,
        screenY: data.clientY,
        isTrusted: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault(): void {},
        stopPropagation(): void {},
    } as unknown as Event;
}

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

export function createNativeKeyboardEvent(data: NativeKeyboardEventData): Event {
    return {
        ...data,
        repeat: data.repeat ?? false,
        ctrlKey: data.ctrlKey ?? false,
        shiftKey: data.shiftKey ?? false,
        altKey: data.altKey ?? false,
        metaKey: data.metaKey ?? false,
        isTrusted: true,
        preventDefault(): void {},
        stopPropagation(): void {},
    } as unknown as Event;
}

/** Minimal Pixi environment adapter for Node's native WGPU runtime. */
export class NodeDOMAdapter {
    public readonly isOffscreenCanvasSupported = false;

    private readonly gpu: NodeGPUInstance;
    private readonly refreshRateHz: number;
    private readonly waitForPresent?: () => Promise<boolean>;
    private frameScheduler?: FrameScheduler | VSyncFrameScheduler;
    private readonly globalListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

    public constructor(
        gpu: NodeGPUInstance,
        refreshRateHz = 60,
        waitForPresent?: () => Promise<boolean>,
    ) {
        this.gpu = gpu;
        this.refreshRateHz = normalizeRefreshRate(refreshRateHz);
        this.waitForPresent = waitForPresent;
    }

    public createCanvas(width = 1, height = 1): HTMLCanvasElement {
        return new NodeCanvas(width, height) as unknown as HTMLCanvasElement;
    }

    public getCanvasRenderingContext2D(): { prototype: object } {
        const context = new NodeCanvas().getContext("2d") as object;
        const contextPrototype = Object.getPrototypeOf(context);
        class ContextConstructor {
            public constructor(canvas: NodeCanvas) {
                return canvas.getContext("2d") as never;
            }
        }
        Object.setPrototypeOf(ContextConstructor.prototype, contextPrototype);
        return ContextConstructor as unknown as { prototype: object };
    }

    public getNavigator(): { userAgent: string; gpu: NodeGPUInstance | null } {
        return { userAgent: "Node native WebGPU", gpu: this.gpu as unknown as GPU };
    }

    public createImage(): HTMLImageElement {
        const image = new Image();
        const imagePrototype = Object.getPrototypeOf(image) as object;
        const sourceDescriptor = Object.getOwnPropertyDescriptor(imagePrototype, "src");

        if (!sourceDescriptor?.get || !sourceDescriptor.set) {
            throw new Error("Native image source property is unavailable");
        }

        Object.defineProperty(image, "src", {
            configurable: true,
            enumerable: sourceDescriptor.enumerable,
            get: () => sourceDescriptor.get?.call(image),
            set: (value: string) => {
                sourceDescriptor.set?.call(
                    image,
                    value.startsWith("file:") ? fileURLToPath(value) : value,
                );
            },
        });
        return image as unknown as HTMLImageElement;
    }
    public getWebGLRenderingContext(): never { throw new Error("WebGL is intentionally unsupported in this PoC"); }
    public getBaseUrl(): string { return "file:///"; }
    public getFontFaceSet(): null { return null; }
    public async fetch(url: RequestInfo | URL, options?: RequestInit): Promise<Response> {
        const source =
            typeof url === "string"
                ? url
                : url instanceof URL
                  ? url.href
                  : url.url;
        const localPath = source.startsWith("file:")
            ? fileURLToPath(source)
            : isAbsolute(source)
              ? source
              : null;

        if (localPath) {
            const data = await readFile(localPath);
            return new Response(new Uint8Array(data), { status: 200 });
        }
        return globalThis.fetch(url, options);
    }
    public parseXML(): never { throw new Error("XML parsing is not implemented in the native WGPU PoC"); }

    private installFrameScheduler(): void {
        const scheduler = this.waitForPresent
            ? new VSyncFrameScheduler({
                  waitForPresent: this.waitForPresent,
                  fallbackFrameIntervalMS: 1000 / this.refreshRateHz,
              })
            : new FrameScheduler({ frameIntervalMS: 1000 / this.refreshRateHz });
        this.frameScheduler = scheduler;
        console.log({
            animationFrameSource: this.waitForPresent
                ? "DXGI frame-latency signal"
                : "deadline timer",
            refreshRateHz: this.refreshRateHz,
        });
        (globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback): number =>
            scheduler.request(callback);
        (globalThis as any).cancelAnimationFrame = (id: number): void => {
            scheduler.cancel(id);
        };
    }

    /** Runs every pending RAF consumer while Windows owns the modal move/resize loop. */
    public dispatchModalFrame(timestamp = performance.now()): number {
        return this.frameScheduler?.dispatchNow(timestamp) ?? 0;
    }

    /** Delivers SDL-translated events registered on document/window globals. */
    public dispatchGlobalEvent(type: string, event: Event): void {
        const listeners = this.globalListeners.get(type);
        if (!listeners) return;
        for (const listener of [...listeners]) {
            if (typeof listener === "function") listener(event);
            else listener.handleEvent(event);
        }
    }

    public install(): void {
        const canvas2d = this.createCanvas().getContext("2d");
        if (!canvas2d) throw new Error("Native Canvas2D backend is unavailable");
        DOMAdapter.set(this as never);
        const globalObject = globalThis as any;
        if (!globalObject.HTMLCanvasElement) globalObject.HTMLCanvasElement = NodeCanvas;
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
        const addGlobalListener = (type: string, listener: EventListenerOrEventListenerObject): void => {
            let listeners = this.globalListeners.get(type);
            if (!listeners) {
                listeners = new Set();
                this.globalListeners.set(type, listeners);
            }
            listeners.add(listener);
        };
        const removeGlobalListener = (type: string, listener: EventListenerOrEventListenerObject): void => {
            const listeners = this.globalListeners.get(type);
            listeners?.delete(listener);
            if (listeners?.size === 0) this.globalListeners.delete(type);
        };
        (globalThis as any).addEventListener = addGlobalListener;
        (globalThis as any).removeEventListener = removeGlobalListener;
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
                    addEventListener: addGlobalListener,
                    removeEventListener: removeGlobalListener,
                    canPlayType() { return ""; }
                };
                return element;
            };
            (globalThis as any).document = {
                baseURI: "file:///",
                createElement: makeElement,
                createElementNS: (_namespace: string, tagName: string) => makeElement(tagName),
                addEventListener: addGlobalListener,
                removeEventListener: removeGlobalListener,
            };
        }
        this.installFrameScheduler();
    }
}

export function normalizeRefreshRate(refreshRateHz: number): number {
    return Number.isFinite(refreshRateHz) &&
        refreshRateHz >= 24 &&
        refreshRateHz <= 360
        ? refreshRateHz
        : 60;
}
