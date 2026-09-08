export interface NativePlatformModules {
    readonly target: string;
    readonly gpuModule: string;
    readonly windowModule: string;
    readonly videoModule: string;
    readonly audioBinding?: string;
    readonly ffmpeg: string;
    readonly ffprobe: string;
}
/** Resolves the one installed native package for the active OS and architecture. */
export declare function resolveNativePlatformModules(platform?: NodeJS.Platform, arch?: string, loadPackage?: (name: string) => NativePlatformModules): NativePlatformModules;
export declare function loadNativeGpu(): unknown;
export declare function loadNativeWindow<T>(): T;
export declare function loadNativeVideo<T>(): T;
