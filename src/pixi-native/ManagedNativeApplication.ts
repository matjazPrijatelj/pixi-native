import {
    createNativeKeyboardEvent,
    createNativeMouseEvent,
} from "./NodeDOMAdapter.ts";
import type { NodeNativeInput, NodeWindowHandle } from "./nativeTypes.ts";

const PRESENT_PRIORITY = -50;

type NativeEvent = Record<string, unknown>;
type FrameCallback = (timestamp: number) => void;
type RequestFrame = (callback: FrameCallback) => number;
type CancelFrame = (requestId: number) => void;
type ManagedTicker = {
    add(callback: () => void, context?: unknown, priority?: number): unknown;
    remove(callback: () => void, context?: unknown): unknown;
    start(): void;
    stop(): void;
};

export interface ManagedRuntimeNative {
    readonly window: NodeWindowHandle;
    readonly input: NodeNativeInput;
    readonly device?: GPUDevice | null;
    readonly swap?: () => void;
    destroy(): void;
}

export interface ManagedNativeApplication<TApplication, TNative> {
    readonly app: TApplication;
    readonly native: TNative;
    readonly destroy: () => Promise<void>;
    readonly addDestroyListener: (
        listener: () => void | Promise<void>,
    ) => () => void;
}

export interface ManageNativeApplicationOptions<TApplication, TNative> {
    readonly app: TApplication & { readonly ticker: ManagedTicker };
    readonly native: TNative & ManagedRuntimeNative;
    readonly present?: () => void;
    readonly destroyApplication: () => void | Promise<void>;
    /** @internal Test seam for the browser-like animation frame scheduler. */
    readonly requestFrame?: RequestFrame;
    /** @internal Test seam for the browser-like animation frame scheduler. */
    readonly cancelFrame?: CancelFrame;
}

function readBoolean(
    event: NativeEvent,
    primary: string,
    fallback: string,
): boolean {
    return Boolean(event[primary] ?? event[fallback]);
}

function readNumber(event: NativeEvent, name: string, fallback = 0): number {
    const value = Number(event[name] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
}

/** Owns the browser-like runtime loop and native lifecycle around a Pixi app. */
export function manageNativeApplication<TApplication, TNative>(
    options: ManageNativeApplicationOptions<TApplication, TNative>,
): ManagedNativeApplication<TApplication, TNative> {
    const { app, native, destroyApplication } = options;
    const requestFrame =
        options.requestFrame ??
        globalThis.requestAnimationFrame.bind(globalThis);
    const cancelFrame =
        options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
    const presentFrame = options.present ?? native.swap;
    if (!presentFrame) {
        throw new Error(
            "Managed native application requires a present callback",
        );
    }
    const destroyListeners = new Set<() => void | Promise<void>>();
    let mouseButtons = 0;
    let active = true;
    let pollingEvents = false;
    let pollFrameRequest: number | undefined;
    let destroyPromise: Promise<void> | undefined;

    const pollEvents = (): void => {
        pollFrameRequest = undefined;
        if (!active) return;

        // Rearm first: glfwPollEvents enters a blocking Win32 modal loop while
        // moving/resizing, where the native timer dispatches queued RAF work.
        pollFrameRequest = requestFrame(pollEvents);
        if (pollingEvents) return;

        pollingEvents = true;
        try {
            native.window.pollEvents?.();
        } finally {
            pollingEvents = false;
        }
    };
    const present = (): void => {
        if (active) presentFrame();
    };

    native.window.on("mouseButtonDown", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        const button = Math.max(0, readNumber(event, "button", 1) - 1);
        mouseButtons |= 1 << button;
        native.input.dispatchCanvasEvent(
            "mousedown",
            createNativeMouseEvent({
                type: "mousedown",
                clientX: readNumber(event, "x"),
                clientY: readNumber(event, "y"),
                button,
                buttons: mouseButtons,
            }),
        );
    });
    native.window.on("mouseButtonUp", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        const button = Math.max(0, readNumber(event, "button", 1) - 1);
        mouseButtons &= ~(1 << button);
        native.input.dispatchGlobalEvent(
            "mouseup",
            createNativeMouseEvent({
                type: "mouseup",
                clientX: readNumber(event, "x"),
                clientY: readNumber(event, "y"),
                button,
                buttons: mouseButtons,
            }),
        );
    });
    native.window.on("mouseMove", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        native.input.dispatchGlobalEvent(
            "mousemove",
            createNativeMouseEvent({
                type: "mousemove",
                clientX: readNumber(event, "x"),
                clientY: readNumber(event, "y"),
                button: -1,
                buttons: mouseButtons,
            }),
        );
    });
    native.window.on("mouseWheel", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        const direction = event.flipped ? -1 : 1;
        native.input.dispatchCanvasEvent(
            "wheel",
            createNativeMouseEvent({
                type: "wheel",
                clientX: readNumber(event, "x"),
                clientY: readNumber(event, "y"),
                button: -1,
                buttons: mouseButtons,
                deltaX: readNumber(event, "dx") * direction,
                deltaY: readNumber(event, "dy") * direction,
            }),
        );
    });
    native.window.on("keyDown", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        native.input.dispatchGlobalEvent(
            "keydown",
            createNativeKeyboardEvent({
                type: "keydown",
                key: String(event.key ?? ""),
                code: String(event.code ?? event.scancode ?? ""),
                repeat: Boolean(event.repeat),
                ctrlKey: readBoolean(event, "ctrlKey", "ctrl"),
                shiftKey: readBoolean(event, "shiftKey", "shift"),
                altKey: readBoolean(event, "altKey", "alt"),
                metaKey: readBoolean(event, "metaKey", "super"),
            }),
        );
    });
    native.window.on("keyUp", (rawEvent) => {
        if (!active) return;
        const event = rawEvent as NativeEvent;
        native.input.dispatchGlobalEvent(
            "keyup",
            createNativeKeyboardEvent({
                type: "keyup",
                key: String(event.key ?? ""),
                code: String(event.code ?? event.scancode ?? ""),
                ctrlKey: readBoolean(event, "ctrlKey", "ctrl"),
                shiftKey: readBoolean(event, "shiftKey", "shift"),
                altKey: readBoolean(event, "altKey", "alt"),
                metaKey: readBoolean(event, "metaKey", "super"),
            }),
        );
    });
    native.window.on("resize", () => {
        if (!active) return;
        const globalObject = globalThis as typeof globalThis & {
            innerWidth?: number;
            innerHeight?: number;
        };
        globalObject.innerWidth = native.window.pixelWidth;
        globalObject.innerHeight = native.window.pixelHeight;
        native.input.dispatchGlobalEvent("resize", new Event("resize"));
    });

    app.ticker.add(present, undefined, PRESENT_PRIORITY);
    app.ticker.start();
    pollFrameRequest = requestFrame(pollEvents);

    const removeProcessListeners = (): void => {
        process.off("SIGINT", handleSignal);
        process.off("SIGTERM", handleSignal);
    };
    const destroy = (): Promise<void> => {
        if (destroyPromise) return destroyPromise;
        active = false;
        if (pollFrameRequest !== undefined) {
            cancelFrame(pollFrameRequest);
            pollFrameRequest = undefined;
        }
        destroyPromise = (async () => {
            let firstError: unknown;
            const run = async (
                operation: () => void | Promise<void>,
            ): Promise<void> => {
                try {
                    await operation();
                } catch (error) {
                    firstError ??= error;
                }
            };

            app.ticker.stop();
            app.ticker.remove(present);
            removeProcessListeners();
            for (const listener of [...destroyListeners]) await run(listener);
            destroyListeners.clear();
            await run(async () => native.device?.queue.onSubmittedWorkDone?.());
            await run(destroyApplication);
            await run(() => native.destroy());
            if (firstError) throw firstError;
        })();
        return destroyPromise;
    };
    function handleSignal(): void {
        void destroy().catch((error) => console.error(error));
    }

    native.window.on("close", handleSignal);
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    return {
        app,
        native,
        destroy,
        addDestroyListener: (listener) => {
            destroyListeners.add(listener);
            return () => destroyListeners.delete(listener);
        },
    };
}
