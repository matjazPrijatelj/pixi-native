import type {
  NativeSurfaceDescriptor,
  NodeWindowHandle,
} from "./nativeTypes.ts";
import type { ResolvedNodeRendererOptions } from "./windowOptions.ts";
import { loadNativeWindow } from "./platformNative.ts";

interface NativeWindowApi {
    createWindow(options: {
        title: string;
        width: number;
        height: number;
        resizable: boolean;
        borderless: boolean;
        transparent: boolean;
        x?: number;
        y?: number;
        graphics: "webgpu" | "webgl";
    }): NodeWindowHandle;
}

export interface NodeSdl3Window extends NodeWindowHandle {
    readonly surface: NativeSurfaceDescriptor;
    readonly transparent: boolean;
    makeGlCurrent(): boolean;
    setGlSwapInterval(interval: number): boolean;
    swapGl(): boolean;
}

let warnedTransparencyFallback = false;

/** Creates the SDL3 window owned by the installed napi-rs platform add-on. */
export function createNativeWindow(
  options: ResolvedNodeRendererOptions,
  graphics: "webgpu" | "webgl",
): NodeSdl3Window {
    const nativeWindow = loadNativeWindow<NativeWindowApi>();
    const window = nativeWindow.createWindow({
        title: options.title,
        width: options.width,
        height: options.height,
        resizable: options.resizable,
        borderless: options.borderless,
        transparent: options.transparent,
        x: options.x,
        y: options.y,
        graphics,
    }) as NodeSdl3Window;
    if (options.transparent && !window.transparent && !warnedTransparencyFallback) {
        warnedTransparencyFallback = true;
        console.warn(
            `[pixi-native] SDL3 ${window.videoDriver ?? "unknown"}/${window.surface.api} could not create a transparent window; continuing opaque.`,
        );
    }
    return window;
}
