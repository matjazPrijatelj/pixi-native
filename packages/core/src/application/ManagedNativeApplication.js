import { createNativeKeyboardEvent, createNativeMouseEvent, } from "../runtime/NodeDOMAdapter.js";
const PRESENT_PRIORITY = -50;
function readBoolean(event, primary, fallback) {
    return Boolean(event[primary] ?? event[fallback]);
}
function readNumber(event, name, fallback = 0) {
    const value = Number(event[name] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
}
/** Owns the browser-like runtime loop and native lifecycle around a Pixi app. */
export function manageNativeApplication(options) {
    const { app, native, destroyApplication } = options;
    const requestFrame = options.requestFrame ??
        globalThis.requestAnimationFrame.bind(globalThis);
    const cancelFrame = options.cancelFrame ?? globalThis.cancelAnimationFrame.bind(globalThis);
    const presentFrame = options.present ?? native.swap;
    if (!presentFrame) {
        throw new Error("Managed native application requires a present callback");
    }
    const destroyListeners = new Set();
    let mouseButtons = 0;
    let active = true;
    let pollingEvents = false;
    let pollFrameRequest;
    let destroyPromise;
    const pollEvents = () => {
        pollFrameRequest = undefined;
        if (!active)
            return;
        // Rearm first: glfwPollEvents enters a blocking Win32 modal loop while
        // moving/resizing, where the native timer dispatches queued RAF work.
        pollFrameRequest = requestFrame(pollEvents);
        if (pollingEvents)
            return;
        pollingEvents = true;
        try {
            native.window.pollEvents?.();
        }
        finally {
            pollingEvents = false;
        }
    };
    const present = () => {
        if (active)
            presentFrame();
    };
    native.window.on("mouseButtonDown", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        const button = Math.max(0, readNumber(event, "button", 1) - 1);
        mouseButtons |= 1 << button;
        native.input.dispatchCanvasEvent("mousedown", createNativeMouseEvent({
            type: "mousedown",
            clientX: readNumber(event, "x"),
            clientY: readNumber(event, "y"),
            button,
            buttons: mouseButtons,
        }));
    });
    native.window.on("mouseButtonUp", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        const button = Math.max(0, readNumber(event, "button", 1) - 1);
        mouseButtons &= ~(1 << button);
        native.input.dispatchGlobalEvent("mouseup", createNativeMouseEvent({
            type: "mouseup",
            clientX: readNumber(event, "x"),
            clientY: readNumber(event, "y"),
            button,
            buttons: mouseButtons,
        }));
    });
    native.window.on("mouseMove", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        native.input.dispatchGlobalEvent("mousemove", createNativeMouseEvent({
            type: "mousemove",
            clientX: readNumber(event, "x"),
            clientY: readNumber(event, "y"),
            button: -1,
            buttons: mouseButtons,
        }));
    });
    native.window.on("mouseWheel", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        const direction = event.flipped ? -1 : 1;
        native.input.dispatchCanvasEvent("wheel", createNativeMouseEvent({
            type: "wheel",
            clientX: readNumber(event, "x"),
            clientY: readNumber(event, "y"),
            button: -1,
            buttons: mouseButtons,
            deltaX: readNumber(event, "dx") * direction,
            deltaY: readNumber(event, "dy") * direction,
        }));
    });
    native.window.on("keyDown", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        native.input.dispatchGlobalEvent("keydown", createNativeKeyboardEvent({
            type: "keydown",
            key: String(event.key ?? ""),
            code: String(event.code ?? event.scancode ?? ""),
            repeat: Boolean(event.repeat),
            ctrlKey: readBoolean(event, "ctrlKey", "ctrl"),
            shiftKey: readBoolean(event, "shiftKey", "shift"),
            altKey: readBoolean(event, "altKey", "alt"),
            metaKey: readBoolean(event, "metaKey", "super"),
        }));
    });
    native.window.on("keyUp", (rawEvent) => {
        if (!active)
            return;
        const event = rawEvent;
        native.input.dispatchGlobalEvent("keyup", createNativeKeyboardEvent({
            type: "keyup",
            key: String(event.key ?? ""),
            code: String(event.code ?? event.scancode ?? ""),
            ctrlKey: readBoolean(event, "ctrlKey", "ctrl"),
            shiftKey: readBoolean(event, "shiftKey", "shift"),
            altKey: readBoolean(event, "altKey", "alt"),
            metaKey: readBoolean(event, "metaKey", "super"),
        }));
    });
    native.window.on("resize", () => {
        if (!active)
            return;
        const globalObject = globalThis;
        globalObject.innerWidth = native.window.pixelWidth;
        globalObject.innerHeight = native.window.pixelHeight;
        native.input.dispatchGlobalEvent("resize", new Event("resize"));
    });
    app.ticker.add(present, undefined, PRESENT_PRIORITY);
    app.ticker.start();
    pollFrameRequest = requestFrame(pollEvents);
    const removeProcessListeners = () => {
        process.off("SIGINT", handleSignal);
        process.off("SIGTERM", handleSignal);
    };
    const destroy = () => {
        if (destroyPromise)
            return destroyPromise;
        active = false;
        if (pollFrameRequest !== undefined) {
            cancelFrame(pollFrameRequest);
            pollFrameRequest = undefined;
        }
        destroyPromise = (async () => {
            let firstError;
            const run = async (operation) => {
                try {
                    await operation();
                }
                catch (error) {
                    firstError ??= error;
                }
            };
            app.ticker.stop();
            app.ticker.remove(present);
            removeProcessListeners();
            for (const listener of [...destroyListeners])
                await run(listener);
            destroyListeners.clear();
            await run(async () => native.device?.queue.onSubmittedWorkDone?.());
            await run(destroyApplication);
            await run(() => native.destroy());
            if (firstError)
                throw firstError;
        })();
        return destroyPromise;
    };
    function handleSignal() {
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
