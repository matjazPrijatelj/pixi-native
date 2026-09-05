import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ModalFrameController {
    detach(): void;
}

interface NativeWindowApi {
    setGlFramebufferTransparent(nativeData: Uint8Array, transparent: boolean): void;
    setTransparent(nativeData: Uint8Array, transparent: boolean): void;
    create(
        nativeData: Uint8Array,
        onFrame: () => void,
        onState: (active: boolean) => void,
    ): ModalFrameController;
}

/** Applies the Windows layered-framebuffer workaround for GLFW OpenGL windows. */
export function setNativeGlFramebufferTransparent(
    nativeData: Uint8Array,
    transparent: boolean,
): void {
    if (!transparent) return;
    if (process.platform !== "win32") {
        throw new Error("transparent native windows are supported only on Windows 11");
    }
    const nativeWindow = require("../../native/window") as NativeWindowApi;
    nativeWindow.setGlFramebufferTransparent(nativeData, true);
}

/** Configures compositor transparency before the WebGPU surface is created. */
export function setNativeWindowTransparent(
    nativeData: Uint8Array,
    transparent: boolean,
): void {
    if (!transparent) return;
    if (process.platform !== "win32") {
        throw new Error("transparent native windows are supported only on Windows 11");
    }
    const nativeWindow = require("../../native/window") as NativeWindowApi;
    nativeWindow.setTransparent(nativeData, true);
}

const NOOP_MODAL_FRAME_CONTROLLER: ModalFrameController = {
    detach: () => undefined,
};

/** Loads the Win32 modal-loop bridge only on the platform that provides it. */
export function createModalFrameController(
    nativeData: Uint8Array,
    onFrame: () => void,
    onState: (active: boolean) => void,
    platform: NodeJS.Platform = process.platform,
): ModalFrameController {
    if (platform !== "win32") return NOOP_MODAL_FRAME_CONTROLLER;

    const nativeWindow = require("../../native/window") as NativeWindowApi;
    return nativeWindow.create(nativeData, onFrame, onState);
}
