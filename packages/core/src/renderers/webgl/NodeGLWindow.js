/** Adapts GLFW's browser-shaped events to the renderer's existing native API. */
export class NodeGLWindow {
    isDestroyed = false;
    closeNotified = false;
    closeListeners = new Set();
    glfwWindow;
    glfw;
    constructor(glfwWindow, glfw) {
        this.glfwWindow = glfwWindow;
        this.glfw = glfw;
    }
    get x() { return this.glfwWindow.x; }
    get y() { return this.glfwWindow.y; }
    get pixelWidth() { return this.glfwWindow.framebufferSize.width; }
    get pixelHeight() { return this.glfwWindow.framebufferSize.height; }
    /** Encodes the GLFW platform handle for the native Windows modal hook. */
    get nativeWindowData() {
        const handle = this.glfwWindow.platformWindow;
        if (!Number.isSafeInteger(handle) || handle < 0) {
            throw new Error(`Invalid native GL window handle: ${handle}`);
        }
        const data = new Uint8Array(process.arch === "ia32" ? 4 : 8);
        const view = new DataView(data.buffer);
        if (data.byteLength === 4)
            view.setUint32(0, handle, true);
        else
            view.setBigUint64(0, BigInt(handle), true);
        return data;
    }
    get display() {
        return { frequency: this.glfwWindow.getCurrentMonitor()?.rate ?? 60 };
    }
    get destroyed() { return this.isDestroyed; }
    pollEvents() {
        this.glfw.pollEvents();
        if (this.glfwWindow.shouldClose && !this.closeNotified) {
            this.closeNotified = true;
            for (const listener of this.closeListeners)
                listener({ type: "close" });
        }
    }
    makeCurrent() { this.glfwWindow.makeCurrent(); }
    swapBuffers() { this.glfwWindow.swapBuffers(); }
    drawWindow(callback) {
        this.glfwWindow.drawWindow(callback);
    }
    setPosition(x, y) {
        this.assertAlive();
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new Error("window x and y must be integers");
        }
        this.glfwWindow.pos = { x, y };
    }
    minimize() {
        this.assertAlive();
        this.glfwWindow.iconify();
    }
    maximize() {
        this.assertAlive();
        this.glfw.maximize();
    }
    restore() {
        this.assertAlive();
        this.glfwWindow.restore();
    }
    on(event, listener) {
        const eventMap = {
            resize: "resize",
            close: "close",
            mouseButtonDown: "mousedown",
            mouseButtonUp: "mouseup",
            mouseMove: "mousemove",
            mouseWheel: "wheel",
            keyDown: "keydown",
            keyUp: "keyup",
        };
        if (event === "close") {
            this.closeListeners.add(listener);
            return;
        }
        const glfwEvent = eventMap[event];
        if (!glfwEvent)
            throw new Error(`Unsupported native GL window event: ${event}`);
        this.glfwWindow.on(glfwEvent, (raw) => listener(this.normalize(event, raw)));
    }
    destroy() {
        if (this.isDestroyed)
            return;
        this.isDestroyed = true;
        this.glfwWindow.destroy();
    }
    assertAlive() {
        if (this.isDestroyed)
            throw new Error("window is destroyed");
    }
    normalize(event, raw) {
        if (event === "resize") {
            return {
                width: this.pixelWidth,
                height: this.pixelHeight,
            };
        }
        if (event === "mouseButtonDown" || event === "mouseButtonUp" || event === "mouseMove") {
            return {
                x: Number(raw.x ?? 0),
                y: Number(raw.y ?? 0),
                button: Number(raw.button ?? 0),
            };
        }
        if (event === "mouseWheel") {
            return {
                x: Number(raw.x ?? 0),
                y: Number(raw.y ?? 0),
                dx: Number(raw.deltaX ?? raw.dx ?? 0),
                dy: Number(raw.deltaY ?? raw.dy ?? 0),
                flipped: false,
            };
        }
        if (event === "keyDown" || event === "keyUp") {
            return {
                key: typeof raw.key === "string" ? raw.key : null,
                code: typeof raw.code === "string" ? raw.code : null,
                repeat: Boolean(raw.repeat),
                ctrlKey: Boolean(raw.ctrlKey),
                shiftKey: Boolean(raw.shiftKey),
                altKey: Boolean(raw.altKey),
                metaKey: Boolean(raw.metaKey),
                scancode: Number(raw.which ?? 0),
            };
        }
        return raw;
    }
}
