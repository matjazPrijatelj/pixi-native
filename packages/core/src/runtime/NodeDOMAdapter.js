import { Image } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCanvas } from "../canvas/NodeCanvas.js";
import { NodeGLCanvas } from "../canvas/NodeGLCanvas.js";
import { FrameScheduler, VSyncFrameScheduler } from "./FrameScheduler.js";
export function createNativeMouseEvent(data) {
    return {
        ...data,
        pageX: data.clientX,
        pageY: data.clientY,
        offsetX: data.clientX,
        offsetY: data.clientY,
        screenX: data.clientX,
        screenY: data.clientY,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        width: 1,
        height: 1,
        pressure: data.buttons ? 0.5 : 0,
        tiltX: 0,
        tiltY: 0,
        twist: 0,
        tangentialPressure: 0,
        isTrusted: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault() { },
        stopPropagation() { },
    };
}
export function createNativeKeyboardEvent(data) {
    return {
        ...data,
        repeat: data.repeat ?? false,
        ctrlKey: data.ctrlKey ?? false,
        shiftKey: data.shiftKey ?? false,
        altKey: data.altKey ?? false,
        metaKey: data.metaKey ?? false,
        isTrusted: true,
        preventDefault() { },
        stopPropagation() { },
    };
}
/** Minimal Pixi environment adapter for Node's native WGPU runtime. */
export class NodeDOMAdapter {
    isOffscreenCanvasSupported = false;
    gpu;
    webglContext;
    frameRateHz;
    waitForPresent;
    imageConstructor;
    webglRenderingContextConstructor;
    usePixi7CanvasAdapter = false;
    frameScheduler;
    globalListeners = new Map();
    constructor(gpu, frameRateHz = 60, waitForPresent, webglContext, imageConstructor = Image, webglRenderingContextConstructor) {
        this.gpu = gpu;
        this.frameRateHz = normalizeRefreshRate(frameRateHz);
        this.waitForPresent = waitForPresent;
        this.webglContext = webglContext;
        this.imageConstructor = imageConstructor;
        this.webglRenderingContextConstructor = webglRenderingContextConstructor;
    }
    createCanvas(width = 1, height = 1) {
        const canvas = this.webglContext && !this.usePixi7CanvasAdapter
            ? new NodeGLCanvas(this.webglContext, width, height)
            : new NodeCanvas(width, height);
        return canvas;
    }
    getCanvasRenderingContext2D() {
        const context = new NodeCanvas().getContext("2d");
        const contextPrototype = Object.getPrototypeOf(context);
        class ContextConstructor {
            constructor(canvas) {
                return canvas.getContext("2d");
            }
        }
        Object.setPrototypeOf(ContextConstructor.prototype, contextPrototype);
        return ContextConstructor;
    }
    getNavigator() {
        return { userAgent: "Node native WebGPU", gpu: this.gpu };
    }
    createImage() {
        const image = new this.imageConstructor();
        if (this.imageConstructor !== Image) {
            return image;
        }
        const imagePrototype = Object.getPrototypeOf(image);
        const sourceDescriptor = Object.getOwnPropertyDescriptor(imagePrototype, "src");
        if (!sourceDescriptor?.get || !sourceDescriptor.set) {
            throw new Error("Native image source property is unavailable");
        }
        Object.defineProperty(image, "src", {
            configurable: true,
            enumerable: sourceDescriptor.enumerable,
            get: () => sourceDescriptor.get?.call(image),
            set: (value) => {
                sourceDescriptor.set?.call(image, value.startsWith("file:") ? fileURLToPath(value) : value);
            },
        });
        return image;
    }
    getWebGLRenderingContext() {
        if (!this.webglContext)
            throw new Error("Native WebGL context is unavailable");
        // Pixi uses `instanceof WebGLRenderingContext` to distinguish WebGL 1
        // from WebGL 2. Returning the actual native WebGL 1 constructor is
        // important: the WebGL 2 context must not satisfy this check.
        return (this.webglRenderingContextConstructor ??
            this.webglContext.WebGLRenderingContext ??
            (() => {
                throw new Error("Native WebGLRenderingContext constructor is unavailable");
            })());
    }
    getBaseUrl() {
        return "file:///";
    }
    getFontFaceSet() {
        return null;
    }
    async fetch(url, options) {
        const source = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
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
    parseXML() {
        throw new Error("XML parsing is not implemented in the native WGPU PoC");
    }
    installFrameScheduler() {
        this.frameScheduler?.dispose();
        const scheduler = this.waitForPresent
            ? new VSyncFrameScheduler({
                waitForPresent: this.waitForPresent,
                fallbackFrameIntervalMS: 1000 / this.frameRateHz,
            })
            : new FrameScheduler({ frameIntervalMS: 1000 / this.frameRateHz });
        this.frameScheduler = scheduler;
        console.log({
            animationFrameSource: this.waitForPresent
                ? "Windows compositor clock"
                : "deadline timer",
            frameRateHz: this.frameRateHz,
        });
        globalThis.requestAnimationFrame = (callback) => scheduler.request(callback);
        globalThis.cancelAnimationFrame = (id) => {
            scheduler.cancel(id);
        };
    }
    /** Runs every pending RAF consumer while Windows owns the modal move/resize loop. */
    dispatchModalFrame(timestamp = performance.now()) {
        return this.frameScheduler?.dispatchNow(timestamp) ?? 0;
    }
    /** Releases frame and event work owned by this native runtime. */
    dispose() {
        this.frameScheduler?.dispose();
        this.frameScheduler = undefined;
        this.globalListeners.clear();
    }
    /** Delivers SDL-translated events registered on document/window globals. */
    dispatchGlobalEvent(type, event) {
        const listeners = this.globalListeners.get(type);
        if (!listeners)
            return;
        for (const listener of [...listeners]) {
            if (typeof listener === "function")
                listener(event);
            else
                listener.handleEvent(event);
        }
    }
    installEnvironment() {
        const canvas2d = new NodeCanvas().getContext("2d");
        if (!canvas2d)
            throw new Error("Native Canvas2D backend is unavailable");
        const globalObject = globalThis;
        // Pixi 7's Assets image parser constructs `new Image()` directly
        // instead of going through the adapter. Keep that constructor aligned
        // with HTMLImageElement so BaseImageResource accepts the loaded image.
        globalObject.Image = this.imageConstructor;
        // Pixi's CanvasSource uses this constructor for its instanceof check.
        // @napi-rs/canvas may expose a different global constructor, while the
        // project-owned NodeCanvas is the object actually returned by createCanvas.
        globalObject.HTMLCanvasElement = NodeCanvas;
        globalObject.HTMLImageElement = this.imageConstructor;
        // Pixi 7 compares image URLs with the current page location even in
        // its native file-only loader. A stable file URL supplies that origin.
        globalObject.location ??= new URL("file:///");
        const globals = {
            GPUTextureUsage: {
                COPY_SRC: 1,
                COPY_DST: 2,
                TEXTURE_BINDING: 4,
                STORAGE_BINDING: 8,
                RENDER_ATTACHMENT: 16,
            },
            GPUBufferUsage: {
                MAP_READ: 1,
                MAP_WRITE: 2,
                COPY_SRC: 4,
                COPY_DST: 8,
                INDEX: 16,
                VERTEX: 32,
                UNIFORM: 64,
                STORAGE: 128,
                INDIRECT: 256,
                QUERY_RESOLVE: 512,
            },
            GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
            GPUMapMode: { READ: 1, WRITE: 2 },
            GPUColorWrite: { RED: 1, GREEN: 2, BLUE: 4, ALPHA: 8, ALL: 15 },
        };
        for (const [name, value] of Object.entries(globals)) {
            if (!globalThis[name])
                globalThis[name] = value;
        }
        const addGlobalListener = (type, listener) => {
            let listeners = this.globalListeners.get(type);
            if (!listeners) {
                listeners = new Set();
                this.globalListeners.set(type, listeners);
            }
            listeners.add(listener);
        };
        const removeGlobalListener = (type, listener) => {
            const listeners = this.globalListeners.get(type);
            listeners?.delete(listener);
            if (listeners?.size === 0)
                this.globalListeners.delete(type);
        };
        globalThis.addEventListener = addGlobalListener;
        globalThis.removeEventListener = removeGlobalListener;
        globalThis.dispatchEvent = (event) => {
            this.dispatchGlobalEvent(event.type, event);
            return true;
        };
        globalThis.window ??= globalThis;
        if (!globalThis.document) {
            const makeElement = (tagName) => {
                if (tagName.toLowerCase() === "canvas") {
                    return this.createCanvas();
                }
                const element = {
                    tagName: tagName.toUpperCase(),
                    style: {},
                    children: [],
                    parentNode: null,
                    appendChild(child) {
                        child.parentNode = element;
                        element.children.push(child);
                        return child;
                    },
                    removeChild(child) {
                        element.children = element.children.filter((item) => item !== child);
                        child.parentNode = null;
                    },
                    contains(child) {
                        return element.children.includes(child);
                    },
                    remove() {
                        element.parentNode?.removeChild?.(element);
                    },
                    addEventListener: addGlobalListener,
                    removeEventListener: removeGlobalListener,
                    canPlayType() {
                        return "";
                    },
                };
                return element;
            };
            globalThis.document = {
                baseURI: "file:///",
                createElement: makeElement,
                createElementNS: (_namespace, tagName) => makeElement(tagName),
                addEventListener: addGlobalListener,
                removeEventListener: removeGlobalListener,
            };
        }
        this.installFrameScheduler();
    }
    /** Installs this adapter through Pixi 8's DOM adapter registry. */
    installPixi8(registry) {
        this.installEnvironment();
        registry.set(this);
    }
    /** Installs this adapter for Pixi 7's settings-based environment API. */
    installPixi7(settings) {
        this.usePixi7CanvasAdapter = true;
        this.installEnvironment();
        this.patchPixi7Document();
        settings.ADAPTER = this;
    }
    /** Adds the DOM operations used by Pixi 7 when another native document exists. */
    patchPixi7Document() {
        const documentObject = globalThis.document;
        if (!documentObject)
            return;
        const originalCreateElement = documentObject.createElement?.bind(documentObject);
        const createElement = (tagName) => {
            const existing = originalCreateElement?.(tagName);
            if (existing)
                return existing;
            if (tagName.toLowerCase() === "canvas") {
                return this.createCanvas();
            }
            return this.createPixi7Element(tagName);
        };
        documentObject.createElement = createElement;
        documentObject.body ??= this.createPixi7Element("body");
    }
    createPixi7Element(tagName) {
        const element = {
            tagName: tagName.toUpperCase(),
            style: {},
            children: [],
            parentNode: null,
            appendChild: (child) => {
                child.parentNode = element;
                element.children.push(child);
                return child;
            },
            removeChild: (child) => {
                element.children = element.children.filter((item) => item !== child);
                child.parentNode = null;
            },
            contains: (child) => element.children.includes(child),
            addEventListener: () => { },
            removeEventListener: () => { },
            setAttribute: (name, value) => {
                element[name] = value;
            },
            getAttribute: (name) => element[name] ?? null,
            canPlayType: () => "",
        };
        return element;
    }
}
export function normalizeRefreshRate(refreshRateHz) {
    return Number.isFinite(refreshRateHz) &&
        refreshRateHz >= 24 &&
        refreshRateHz <= 360
        ? refreshRateHz
        : 60;
}
