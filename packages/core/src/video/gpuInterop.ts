import type { NodeWindowRenderer } from "../runtime/nativeTypes.ts";
import type { GpuNativeVideoFrame } from "./NativeVideo.ts";

const VIDEO_RENDERERS = new WeakMap<GPUDevice, NodeWindowRenderer>();

/** Registers the native renderer that owns a Dawn device. */
export function registerNativeVideoGpuInterop(
  device: GPUDevice,
  renderer: NodeWindowRenderer,
): void {
  VIDEO_RENDERERS.set(device, renderer);
}

/** Imports and acquires one shared NV12 presentation surface. */
export function acquireNativeVideoGpuTexture(
  device: GPUDevice,
  frame: GpuNativeVideoFrame,
): {
  readonly texture: GPUTexture;
  readonly yView: GPUTextureView;
  readonly uvView: GPUTextureView;
} {
  const renderer = VIDEO_RENDERERS.get(device);
  if (!renderer?.acquireVideoFrame) {
    throw new Error(
      "Native D3D12 video interop is unavailable for this device",
    );
  }
  return renderer.acquireVideoFrame(frame);
}

/**
 * Stops presenting an imported surface without ending its Dawn access scope.
 * The renderer releases it only after the queue has completed all submissions.
 */
export function retireNativeVideoGpuTexture(
  device: GPUDevice,
  frame: GpuNativeVideoFrame,
): boolean {
  return (
    VIDEO_RENDERERS.get(device)?.retireVideoFrame?.({
      sessionId: frame.sessionId,
      surfaceId: frame.surfaceId,
    }) ?? false
  );
}
