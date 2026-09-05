import type { NodeRendererOptions } from "./nativeTypes.ts";

export interface ResolvedNodeRendererOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly resizable: boolean;
  readonly vsync: boolean;
  readonly borderless: boolean;
  readonly transparent: boolean;
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
    throw new Error("transparent native windows are supported only on Windows 11");
  }

  return {
    title: options.title ?? defaultTitle,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    resizable,
    vsync: options.vsync ?? true,
    borderless,
    transparent,
    x: options.x,
    y: options.y,
  };
}
