import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const PLATFORM_PACKAGES = {
    "win32-x64": "@pixi-native/native-win32-x64",
};
/** Resolves the one installed native package for the active OS and architecture. */
export function resolveNativePlatformModules(platform = process.platform, arch = process.arch, loadPackage = (name) => require(name)) {
    const target = `${platform}-${arch}`;
    const packageName = PLATFORM_PACKAGES[target];
    if (!packageName) {
        throw new Error(`pixi-native does not support ${target}`);
    }
    let modules;
    try {
        modules = loadPackage(packageName);
    }
    catch (error) {
        const reason = error instanceof Error ? `: ${error.message}` : "";
        throw new Error(`Missing native package ${packageName} for ${target}${reason}`, { cause: error });
    }
    if (modules.target !== target) {
        throw new Error(`Native package ${packageName} targets ${modules.target}, expected ${target}`);
    }
    return modules;
}
export function loadNativeGpu() {
    const modules = resolveNativePlatformModules();
    return require(modules.gpuModule);
}
export function loadNativeWindow() {
    const modules = resolveNativePlatformModules();
    return require(modules.windowModule);
}
export function loadNativeVideo() {
    const modules = resolveNativePlatformModules();
    return require(modules.videoModule);
}
