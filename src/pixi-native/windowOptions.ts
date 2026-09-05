import type { NodeRendererOptions } from "./nativeTypes.ts";

export const NATIVE_BACKGROUND_COLOR = 0x101544;

/** Produces the RGB values expected by a premultiplied presentation surface. */
export function premultiplyBackgroundColor(
  color: number,
  alpha: number,
): [number, number, number] {
  return [
    (((color >> 16) & 0xff) / 0xff) * alpha,
    (((color >> 8) & 0xff) / 0xff) * alpha,
    ((color & 0xff) / 0xff) * alpha,
  ];
}

export interface ResolvedNodeRendererOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly resizable: boolean;
  readonly vsync: boolean;
  readonly borderless: boolean;
  readonly transparent: boolean;
  readonly backgroundAlpha: number;
  readonly x?: number;
  readonly y?: number;
}

/** Applies shared window defaults and rejects backend-specific ambiguity. */
export function resolveNodeRendererOptions(
  options: NodeRendererOptions,
  defaultTitle: string,
  platform: NodeJS.Platform = process.platform,
): ResolvedNodeRendererOptions {
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
  if (transparent && platform !== "win32") {
    throw new Error(
      "transparent native windows are supported only on Windows 11",
    );
  }
  const requestedBackgroundAlpha =
    options.backgroundAlpha ?? (transparent ? 0 : 1);
  if (
    !Number.isFinite(requestedBackgroundAlpha) ||
    requestedBackgroundAlpha < 0 ||
    requestedBackgroundAlpha > 1
  ) {
    throw new Error("backgroundAlpha must be a finite number from 0 to 1");
  }
  let backgroundAlpha = requestedBackgroundAlpha;
  if (!transparent && requestedBackgroundAlpha < 1) {
    console.warn(
      "[pixi-native] backgroundAlpha below 1 is ignored because transparent is false; using backgroundAlpha: 1",
    );
    backgroundAlpha = 1;
  }

  return {
    title: options.title ?? defaultTitle,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    resizable,
    vsync: options.vsync ?? true,
    borderless,
    transparent,
    backgroundAlpha,
    x: options.x,
    y: options.y,
  };
}
