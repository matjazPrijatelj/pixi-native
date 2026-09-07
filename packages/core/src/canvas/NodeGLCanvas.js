import { NodeCanvas } from "./NodeCanvas.js";
/** HTMLCanvasElement-shaped surface backed by a native WebGL2 context. */
export class NodeGLCanvas {
    style = {};
    _width;
    _height;
    context;
    canvas2d;
    resizeDrawingBuffer;
    listeners = new Map();
    constructor(context, width = 1280, height = 720, resizeDrawingBuffer) {
        this.context = context;
        this.canvas2d = new NodeCanvas(width, height);
        this._width = width;
        this._height = height;
        this.resizeDrawingBuffer = resizeDrawingBuffer;
    }
    get width() {
        return this._width;
    }
    set width(value) {
        this._width = Math.max(1, Math.floor(value));
        this.canvas2d.width = this._width;
    }
    get height() {
        return this._height;
    }
    set height(value) {
        this._height = Math.max(1, Math.floor(value));
        this.canvas2d.height = this._height;
    }
    get clientWidth() {
        return this.width;
    }
    get clientHeight() {
        return this.height;
    }
    getBoundingClientRect() {
        return {
            left: 0,
            top: 0,
            width: this.width,
            height: this.height,
            right: this.width,
            bottom: this.height,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        };
    }
    addEventListener(type, listener) {
        let listeners = this.listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners);
        }
        listeners.add(listener);
    }
    removeEventListener(type, listener) {
        const listeners = this.listeners.get(type);
        listeners?.delete(listener);
        if (listeners?.size === 0)
            this.listeners.delete(type);
    }
    dispatchNativeEvent(type, event) {
        const listeners = this.listeners.get(type);
        if (!listeners)
            return;
        for (const listener of [...listeners]) {
            if (typeof listener === "function")
                listener(event);
            else
                listener.handleEvent(event);
        }
    }
    getContext(type) {
        if (type === "2d")
            return this.canvas2d.getContext("2d");
        return type === "webgl" || type === "webgl2" ? this.context : null;
    }
    /** Returns a stable copy source for the WebGL native image upload adapter. */
    getPremultipliedRgbaPixels() {
        return this.canvas2d.getPremultipliedRgbaPixels();
    }
    get data() {
        return Buffer.from(this.canvas2d.getPremultipliedRgbaPixels());
    }
    resize(width, height) {
        this.width = width;
        this.height = height;
        if (this.resizeDrawingBuffer) {
            this.resizeDrawingBuffer(this.width, this.height);
            return;
        }
        const extension = this.context.getExtension?.("STACKGL_resize_drawingbuffer");
        extension?.resize(this.width, this.height);
    }
}
