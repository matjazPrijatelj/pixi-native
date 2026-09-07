export interface ModalFrameController {
    detach(): void;
}
interface NativeWindowApi {
    setTransparent(nativeData: Uint8Array, transparent: boolean): void;
    waitForCompositorFrame?(timeoutMs?: number): Promise<boolean>;
    create(nativeData: Uint8Array, onFrame: () => void, onState: (active: boolean) => void): ModalFrameController;
}
/** Uses the Windows compositor clock when the installed native addon provides it. */
export declare function createCompositorFrameWaiter(platform?: NodeJS.Platform, nativeWindowOverride?: Pick<NativeWindowApi, "waitForCompositorFrame">): (() => Promise<boolean>) | undefined;
/** Configures compositor transparency before the WebGPU surface is created. */
export declare function setNativeWindowTransparent(nativeData: Uint8Array, transparent: boolean): void;
/** Loads the Win32 modal-loop bridge only on the platform that provides it. */
export declare function createModalFrameController(nativeData: Uint8Array, onFrame: () => void, onState: (active: boolean) => void, platform?: NodeJS.Platform): ModalFrameController;
export {};
