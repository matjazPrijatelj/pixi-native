import { DEFAULT_ANTIALIAS_SAMPLES } from "./nativeTypes.js";
export const NATIVE_BACKGROUND_COLOR = 0x101544;
/** Produces the RGB values expected by a premultiplied presentation surface. */
export function premultiplyBackgroundColor(color, alpha) {
    return [
        (((color >> 16) & 0xff) / 0xff) * alpha,
        (((color >> 8) & 0xff) / 0xff) * alpha,
        ((color & 0xff) / 0xff) * alpha,
    ];
}
/** Applies shared window defaults and rejects backend-specific ambiguity. */
export function resolveNodeRendererOptions(options, defaultTitle, _platform = process.platform) {
    const antialiasSamples = options.antialiasSamples ?? DEFAULT_ANTIALIAS_SAMPLES;
    if (antialiasSamples !== 0 &&
        antialiasSamples !== 2 &&
        antialiasSamples !== 4 &&
        antialiasSamples !== 8) {
        throw new Error("antialiasSamples must be 0, 2, 4, or 8");
    }
    const vsync = options.vsync ?? true;
    let maxFps = options.maxFps;
    if (maxFps !== undefined &&
        (!Number.isFinite(maxFps) || maxFps < 24 || maxFps > 360)) {
        throw new Error("maxFps must be a finite number from 24 to 360");
    }
    if (vsync && maxFps !== undefined) {
        console.warn("[pixi-native] maxFps is ignored because vsync is true; display VSync controls frame pacing");
        maxFps = undefined;
    }
    const borderless = options.borderless ?? false;
    const resizable = options.resizable ?? !borderless;
    if (borderless && resizable) {
        throw new Error("borderless and resizable windows are mutually exclusive");
    }
    const hasX = options.x !== undefined;
    const hasY = options.y !== undefined;
    if (hasX !== hasY) {
        throw new Error("window x and y must be provided together");
    }
    if (hasX && (!Number.isInteger(options.x) || !Number.isInteger(options.y))) {
        throw new Error("window x and y must be integers");
    }
    const transparent = options.transparent ?? false;
    const requestedBackgroundAlpha = options.backgroundAlpha ?? (transparent ? 0 : 1);
    if (!Number.isFinite(requestedBackgroundAlpha) ||
        requestedBackgroundAlpha < 0 ||
        requestedBackgroundAlpha > 1) {
        throw new Error("backgroundAlpha must be a finite number from 0 to 1");
    }
    let backgroundAlpha = requestedBackgroundAlpha;
    if (!transparent && requestedBackgroundAlpha < 1) {
        console.warn("[pixi-native] backgroundAlpha below 1 is ignored because transparent is false; using backgroundAlpha: 1");
        backgroundAlpha = 1;
    }
    return {
        title: options.title ?? defaultTitle,
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        resizable,
        vsync,
        maxFps,
        borderless,
        transparent,
        backgroundAlpha,
        antialiasSamples,
        x: options.x,
        y: options.y,
    };
}
/** Returns the resolved window settings shared by renderer startup logs. */
export function getWindowOptionsDiagnostics(options, window) {
    return {
        title: options.title,
        position: [window.x, window.y],
        resizable: options.resizable,
        vsync: options.vsync,
        maxFps: options.maxFps,
        borderless: options.borderless,
        transparent: options.transparent,
        backgroundAlpha: options.backgroundAlpha,
        antialiasSamples: options.antialiasSamples,
    };
}
/** Reports when a renderer cannot provide the requested MSAA sample count. */
export function warnAntialiasSampleFallback(renderer, requestedSamples, actualSamples) {
    if (requestedSamples === actualSamples)
        return;
    console.warn(`[pixi-native] ${renderer} cannot provide requested ${requestedSamples}x MSAA; using ${actualSamples}x`);
}
/** Maps the shared MSAA option to PixiJS WebGPU's supported 0x/4x modes. */
export function resolveWebGpuAntialiasSamples(requestedSamples) {
    const actualSamples = requestedSamples === 0 ? 0 : 4;
    warnAntialiasSampleFallback("WebGPU", requestedSamples, actualSamples);
    return actualSamples;
}
/** Selects the timer-paced RAF rate without overriding display VSync. */
export function resolveAnimationFrameRate(options, refreshRateHz) {
    return !options.vsync && options.maxFps !== undefined
        ? options.maxFps
        : refreshRateHz;
}
