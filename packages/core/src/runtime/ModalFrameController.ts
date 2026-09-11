import { loadNativeWindow } from "./platformNative.ts";
import type { NodeWindowHandle } from "./nativeTypes.ts";

export interface ModalFrameController {
  detach(): void;
}

interface NativeWindowApi {
  waitForCompositorFrame?(timeoutMs?: number): Promise<boolean>;
  createModalFrameController(
    nativeData: Uint8Array,
    onFrame: () => void,
    onState: (active: boolean) => void,
  ): ModalFrameController;
}

/** Uses the Windows compositor clock when the installed native addon provides it. */
export function createCompositorFrameWaiter(
  platform: NodeJS.Platform = process.platform,
  nativeWindowOverride?: Pick<NativeWindowApi, "waitForCompositorFrame">,
): (() => Promise<boolean>) | undefined {
  if (platform !== "win32") return undefined;
  const nativeWindow =
    nativeWindowOverride ?? loadNativeWindow<NativeWindowApi>();
  if (!nativeWindow.waitForCompositorFrame) return undefined;
  return () => nativeWindow.waitForCompositorFrame!(1_000);
}

const NOOP_MODAL_FRAME_CONTROLLER: ModalFrameController = {
  detach: () => undefined,
};

interface NativeWindowResizeCanvas {
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): void;
}

/** Synchronizes a live native size change before the next modal frame. */
export function syncNativeWindowSize(
  window: Pick<NodeWindowHandle, "pixelWidth" | "pixelHeight">,
  canvas: NativeWindowResizeCanvas,
  resizeRenderer: (width: number, height: number) => void,
  dispatchResize?: () => void,
): boolean {
  const width = window.pixelWidth;
  const height = window.pixelHeight;
  if (width === canvas.width && height === canvas.height) return false;

  canvas.resize(width, height);
  resizeRenderer(width, height);
  dispatchResize?.();
  return true;
}

/** Loads the Win32 modal-loop bridge only on the platform that provides it. */
export function createModalFrameController(
  nativeData: Uint8Array,
  onFrame: () => void,
  onState: (active: boolean) => void,
  platform: NodeJS.Platform = process.platform,
): ModalFrameController {
  if (platform !== "win32") return NOOP_MODAL_FRAME_CONTROLLER;

  const nativeWindow = loadNativeWindow<NativeWindowApi>();
  return nativeWindow.createModalFrameController(nativeData, onFrame, onState);
}
