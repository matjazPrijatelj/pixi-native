export interface NativeWindowApi {
    create(nativeData: Uint8Array, onFrame: () => void, onState: (active: boolean) => void): ModalFrameController;
}

export interface ModalFrameController {
    attach(): void;
    detach(): void;
}

declare const nativeWindow: NativeWindowApi;
export = nativeWindow;
