import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ModalFrameController {
    detach(): void;
}

interface NativeWindowApi {
    create(
        nativeData: Uint8Array,
        onFrame: () => void,
        onState: (active: boolean) => void,
    ): ModalFrameController;
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
