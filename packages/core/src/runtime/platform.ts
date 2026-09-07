export type NativeGpuBackend = "d3d12" | "metal" | "vulkan";

/** Returns the native Dawn backend used when WGPU_BACKEND is not set. */
export function getDefaultGpuBackend(
  platform: NodeJS.Platform,
): NativeGpuBackend {
  if (platform === "win32") return "d3d12";
  if (platform === "darwin") return "metal";
  if (platform === "linux") return "vulkan";
  throw new Error(
    `No default native WebGPU backend is configured for ${platform}`,
  );
}

export function resolveGpuBackend(
  platform: NodeJS.Platform = process.platform,
  override: string | undefined = process.env.WGPU_BACKEND,
): string {
  const requestedBackend = override?.trim();
  return requestedBackend || getDefaultGpuBackend(platform);
}

/** Native FFmpeg video builds are currently packaged for Windows and Linux x64. */
export function supportsNativeVideo(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux";
}

