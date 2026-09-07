import type { AntialiasSamples, NodeRendererOptions, NodeWindowHandle } from "./nativeTypes.ts";
export declare const NATIVE_BACKGROUND_COLOR = 1054020;
/** Produces the RGB values expected by a premultiplied presentation surface. */
export declare function premultiplyBackgroundColor(color: number, alpha: number): [number, number, number];
export interface ResolvedNodeRendererOptions {
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly resizable: boolean;
    readonly vsync: boolean;
    readonly maxFps?: number;
    readonly borderless: boolean;
    readonly transparent: boolean;
    readonly backgroundAlpha: number;
    readonly antialiasSamples: AntialiasSamples;
    readonly x?: number;
    readonly y?: number;
}
/** Applies shared window defaults and rejects backend-specific ambiguity. */
export declare function resolveNodeRendererOptions(options: NodeRendererOptions, defaultTitle: string, _platform?: NodeJS.Platform): ResolvedNodeRendererOptions;
/** Returns the resolved window settings shared by renderer startup logs. */
export declare function getWindowOptionsDiagnostics(options: ResolvedNodeRendererOptions, window: Pick<NodeWindowHandle, "x" | "y">): {
    title: string;
    position: readonly [number, number];
    resizable: boolean;
    vsync: boolean;
    maxFps: number | undefined;
    borderless: boolean;
    transparent: boolean;
    backgroundAlpha: number;
    antialiasSamples: AntialiasSamples;
};
/** Reports when a renderer cannot provide the requested MSAA sample count. */
export declare function warnAntialiasSampleFallback(renderer: string, requestedSamples: number, actualSamples: number): void;
/** Maps the shared MSAA option to PixiJS WebGPU's supported 0x/4x modes. */
export declare function resolveWebGpuAntialiasSamples(requestedSamples: AntialiasSamples): 0 | 4;
/** Selects the timer-paced RAF rate without overriding display VSync. */
export declare function resolveAnimationFrameRate(options: Pick<ResolvedNodeRendererOptions, "vsync" | "maxFps">, refreshRateHz: number): number;
