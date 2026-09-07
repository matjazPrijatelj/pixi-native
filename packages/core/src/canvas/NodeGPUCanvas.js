/** Minimal HTMLCanvasElement-shaped surface for Pixi's WebGPU renderer. */
export class NodeGPUCanvas {
    style = {};
    width;
    height;
    renderer;
    context;
    listeners = new Map();
    constructor(renderer, width = 1280, height = 720) {
        this.renderer = renderer;
        this.context = {
            configure: () => undefined,
            unconfigure: () => undefined,
            getCurrentTexture: () => this.renderer.getCurrentTexture(),
        };
        this.width = width;
        this.height = height;
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
    addEventListener(type, listener, _options) {
        let listeners = this.listeners.get(type);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(type, listeners);
        }
        listeners.add(listener);
    }
    removeEventListener(type, listener, _options) {
        const listeners = this.listeners.get(type);
        listeners?.delete(listener);
        if (listeners?.size === 0)
            this.listeners.delete(type);
    }
    /** Delivers an SDL-translated event to Pixi's DOM event listeners. */
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
        if (type !== "webgpu")
            return null;
        return this.context;
    }
    resize(width, height) {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        this.renderer.resize();
    }
}
