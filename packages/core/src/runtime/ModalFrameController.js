import { loadNativeWindow } from "./platformNative.js";
/** Uses the Windows compositor clock when the installed native addon provides it. */
export function createCompositorFrameWaiter(platform = process.platform, nativeWindowOverride) {
    if (platform !== "win32")
        return undefined;
    const nativeWindow = nativeWindowOverride ?? loadNativeWindow();
    if (!nativeWindow.waitForCompositorFrame)
        return undefined;
    return () => nativeWindow.waitForCompositorFrame(1_000);
}
/** Configures compositor transparency before the WebGPU surface is created. */
export function setNativeWindowTransparent(nativeData, transparent) {
    if (!transparent)
        return;
    if (process.platform !== "win32") {
        throw new Error("transparent native windows are supported only on Windows 11");
    }
    const nativeWindow = loadNativeWindow();
    nativeWindow.setTransparent(nativeData, true);
}
const NOOP_MODAL_FRAME_CONTROLLER = {
    detach: () => undefined,
};
/** Loads the Win32 modal-loop bridge only on the platform that provides it. */
export function createModalFrameController(nativeData, onFrame, onState, platform = process.platform) {
    if (platform !== "win32")
        return NOOP_MODAL_FRAME_CONTROLLER;
    const nativeWindow = loadNativeWindow();
    return nativeWindow.create(nativeData, onFrame, onState);
}
