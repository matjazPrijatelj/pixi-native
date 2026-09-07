export type NativeGpuBackend = "d3d12" | "metal" | "vulkan";
/** Returns the native Dawn backend used when WGPU_BACKEND is not set. */
export declare function getDefaultGpuBackend(platform: NodeJS.Platform): NativeGpuBackend;
export declare function resolveGpuBackend(platform?: NodeJS.Platform, override?: string | undefined): string;
/** Native FFmpeg video builds are currently packaged for Windows and Linux x64. */
export declare function supportsNativeVideo(platform: NodeJS.Platform): boolean;
