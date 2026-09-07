import type { NodeRendererOptions } from "../pixi-native/runtime/nativeTypes.ts";

export const DEMO_WINDOW_OPTIONS = {
  width: 1280,
  height: 720,
  borderless: false,
  transparent: true,
  backgroundAlpha: 0.5,
  x: 50,
  y: 50,
} satisfies NodeRendererOptions;
