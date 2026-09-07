import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface NativePlatformModules {
    readonly target: string;
    readonly gpuModule: string;
    readonly windowModule: string;
    readonly videoModule: string;
    readonly audioBinding: string;
    readonly ffmpeg: string;
    readonly ffprobe: string;
}

const PLATFORM_PACKAGES: Readonly<Record<string, string>> = {
    "win32-x64": "@pixi-native/native-win32-x64",
};

/** Resolves the one installed native package for the active OS and architecture. */
export function resolveNativePlatformModules(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
    loadPackage: (name: string) => NativePlatformModules = (name) =>
        require(name) as NativePlatformModules,
): NativePlatformModules {
    const target = `${platform}-${arch}`;
    const packageName = PLATFORM_PACKAGES[target];
    if (!packageName) {
        throw new Error(`pixi-native does not support ${target}`);
    }

    let modules: NativePlatformModules;
    try {
        modules = loadPackage(packageName);
    } catch (error) {
        const reason = error instanceof Error ? `: ${error.message}` : "";
        throw new Error(
            `Missing native package ${packageName} for ${target}${reason}`,
            { cause: error },
        );
    }
    if (modules.target !== target) {
        throw new Error(
            `Native package ${packageName} targets ${modules.target}, expected ${target}`,
        );
    }
    return modules;
}

export function loadNativeGpu(): unknown {
    const modules = resolveNativePlatformModules();
    return require(modules.gpuModule) as unknown;
}

export function loadNativeWindow<T>(): T {
    const modules = resolveNativePlatformModules();
    return require(modules.windowModule) as T;
}

export function loadNativeVideo<T>(): T {
    const modules = resolveNativePlatformModules();
    return require(modules.videoModule) as T;
}
