import type { NodeWindowHandle } from "./nativeTypes.ts";

export interface GlWindowMouseEvent {
    readonly x: number;
    readonly y: number;
    readonly button: number;
}

export interface GlWindowKeyEvent {
    readonly key: string | null;
    readonly code: string | null;
    readonly repeat: boolean;
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    readonly scancode: number;
}

type GlfwEvent = Record<string, unknown>;
type GlfwWindow = {
    readonly framebufferSize: { width: number; height: number };
    readonly width: number;
    readonly height: number;
    readonly x: number;
    readonly y: number;
    pos: { x: number; y: number };
    readonly shouldClose: boolean;
    readonly currentContext: unknown;
    readonly platformWindow: number;
    getCurrentMonitor(): { rate: number } | null;
    makeCurrent(): void;
    swapBuffers(): void;
    drawWindow(callback: (timestamp: number) => void): void;
    iconify(): void;
    restore(): void;
    destroy(): void;
    on(event: string, listener: (event: GlfwEvent) => void): void;
};

type GlfwWindowApi = {
    pollEvents(): void;
    maximize(): void;
};

/** Adapts GLFW's browser-shaped events to the renderer's existing native API. */
export class NodeGLWindow implements NodeWindowHandle {
    private isDestroyed = false;
    private closeNotified = false;
    private readonly closeListeners = new Set<(event: unknown) => void>();
    private readonly glfwWindow: GlfwWindow;
    private readonly glfw: GlfwWindowApi;

    public constructor(glfwWindow: GlfwWindow, glfw: GlfwWindowApi) {
        this.glfwWindow = glfwWindow;
        this.glfw = glfw;
    }

    public get x(): number { return this.glfwWindow.x; }
    public get y(): number { return this.glfwWindow.y; }
    public get pixelWidth(): number { return this.glfwWindow.framebufferSize.width; }
    public get pixelHeight(): number { return this.glfwWindow.framebufferSize.height; }
    /** Encodes the GLFW platform handle for the native Windows modal hook. */
    public get nativeWindowData(): Uint8Array {
        const handle = this.glfwWindow.platformWindow;
        if (!Number.isSafeInteger(handle) || handle < 0) {
            throw new Error(`Invalid native GL window handle: ${handle}`);
        }
        const data = new Uint8Array(process.arch === "ia32" ? 4 : 8);
        const view = new DataView(data.buffer);
        if (data.byteLength === 4) view.setUint32(0, handle, true);
        else view.setBigUint64(0, BigInt(handle), true);
        return data;
    }
    public get display(): { readonly frequency: number } {
        return { frequency: this.glfwWindow.getCurrentMonitor()?.rate ?? 60 };
    }
    public get destroyed(): boolean { return this.isDestroyed; }
    public pollEvents(): void {
        this.glfw.pollEvents();
        if (this.glfwWindow.shouldClose && !this.closeNotified) {
            this.closeNotified = true;
            for (const listener of this.closeListeners) listener({ type: "close" });
        }
    }

    public makeCurrent(): void { this.glfwWindow.makeCurrent(); }
    public swapBuffers(): void { this.glfwWindow.swapBuffers(); }
    public drawWindow(callback: (timestamp: number) => void): void {
        this.glfwWindow.drawWindow(callback);
    }

    public setPosition(x: number, y: number): void {
        this.assertAlive();
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new Error("window x and y must be integers");
        }
        this.glfwWindow.pos = { x, y };
    }

    public minimize(): void {
        this.assertAlive();
        this.glfwWindow.iconify();
    }

    public maximize(): void {
        this.assertAlive();
        this.glfw.maximize();
    }

    public restore(): void {
        this.assertAlive();
        this.glfwWindow.restore();
    }

    public on(event: string, listener: (event: unknown) => void): void {
        const eventMap: Record<string, string> = {
            resize: "resize",
            close: "close",
            mouseButtonDown: "mousedown",
            mouseButtonUp: "mouseup",
            mouseMove: "mousemove",
            keyDown: "keydown",
            keyUp: "keyup",
        };
        if (event === "close") {
            this.closeListeners.add(listener);
            return;
        }
        const glfwEvent = eventMap[event];
        if (!glfwEvent) throw new Error(`Unsupported native GL window event: ${event}`);
        this.glfwWindow.on(glfwEvent, (raw) => listener(this.normalize(event, raw)));
    }

    public destroy(): void {
        if (this.isDestroyed) return;
        this.isDestroyed = true;
        this.glfwWindow.destroy();
    }

    private assertAlive(): void {
        if (this.isDestroyed) throw new Error("window is destroyed");
    }

    private normalize(event: string, raw: GlfwEvent): unknown {
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
            } satisfies GlWindowMouseEvent;
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
            } satisfies GlWindowKeyEvent;
        }
        return raw;
    }
}
