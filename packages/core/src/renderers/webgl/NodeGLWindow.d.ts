import type { NodeWindowHandle } from "../../runtime/nativeTypes.ts";
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
    readonly framebufferSize: {
        width: number;
        height: number;
    };
    readonly width: number;
    readonly height: number;
    readonly x: number;
    readonly y: number;
    pos: {
        x: number;
        y: number;
    };
    readonly shouldClose: boolean;
    readonly currentContext: unknown;
    readonly platformWindow: number;
    getCurrentMonitor(): {
        rate: number;
    } | null;
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
export declare class NodeGLWindow implements NodeWindowHandle {
    private isDestroyed;
    private closeNotified;
    private readonly closeListeners;
    private readonly glfwWindow;
    private readonly glfw;
    constructor(glfwWindow: GlfwWindow, glfw: GlfwWindowApi);
    get x(): number;
    get y(): number;
    get pixelWidth(): number;
    get pixelHeight(): number;
    /** Encodes the GLFW platform handle for the native Windows modal hook. */
    get nativeWindowData(): Uint8Array;
    get display(): {
        readonly frequency: number;
    };
    get destroyed(): boolean;
    pollEvents(): void;
    makeCurrent(): void;
    swapBuffers(): void;
    drawWindow(callback: (timestamp: number) => void): void;
    setPosition(x: number, y: number): void;
    minimize(): void;
    maximize(): void;
    restore(): void;
    on(event: string, listener: (event: unknown) => void): void;
    destroy(): void;
    private assertAlive;
    private normalize;
}
export {};
