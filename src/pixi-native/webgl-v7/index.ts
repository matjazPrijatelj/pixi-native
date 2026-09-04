import type { Application } from "pixi.js-v7";
import { createRequire } from "node:module";
import { NodeDOMAdapter } from "../NodeDOMAdapter.ts";
import { NodeGLCanvas } from "../NodeGLCanvas.ts";
import { NodeGLWindow } from "../NodeGLWindow.ts";
import { NodeCanvas } from "../NodeCanvas.ts";
import { copyRgbaRowsFlippedY } from "../rgbaUpload.ts";
import type { NodeNativeInput, NodeRendererOptions } from "../nativeTypes.ts";

const require = createRequire(import.meta.url);

export interface PixiWebGL7Result {
  readonly app: Application;
    readonly native: {
        readonly window: NodeGLWindow;
        readonly canvas: NodeGLCanvas;
        readonly input: NodeNativeInput;
        readonly addModalFrameListener: (listener: () => void) => () => void;
        readonly swap: () => void;
    readonly destroy: () => void;
  };
}

/** Creates the minimal Pixi 7 WebGL proof-of-concept on the native surface. */
export async function createPixiWebGL7(
  options: NodeRendererOptions = {},
): Promise<PixiWebGL7Result> {
  const { init, gl: webgl, Image } = await import("@node-3d/core");
  const { glfw } = await import("@node-3d/glfw");
  const { doc } = init({
    title: options.title ?? "PixiJS 7 Native Node WebGL",
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    resizable: options.resizable ?? true,
    vsync: options.vsync ?? true,
    isGles3: true,
    isWebGL2: true,
    autoEsc: true,
  });
  const window = new NodeGLWindow(doc as never, glfw.pollEvents);
  const canvas = new NodeGLCanvas(webgl, window.pixelWidth, window.pixelHeight);
  const adapter = new NodeDOMAdapter(
    null,
    window.display.frequency,
    undefined,
    webgl,
    undefined,
    webgl.WebGLRenderingContext,
  );
  const { Application, settings } = await import("pixi.js-v7");
  adapter.installPixi7(settings);
  const nativeBufferData = webgl.bufferData.bind(webgl) as (
    target: number,
    data: ArrayBufferView,
    usage: number,
  ) => void;
  const nativeTexImage2D = webgl.texImage2D.bind(webgl) as (
    ...args: unknown[]
  ) => void;
  const nativeTexSubImage2D = webgl.texSubImage2D.bind(webgl) as (
    ...args: unknown[]
  ) => void;
  const mutableWebgl = webgl as unknown as {
    bufferSubData: (
      target: number,
      offset: number,
      data: ArrayBufferView,
      srcOffset?: number,
      length?: number,
    ) => void;
    texImage2D: (...args: unknown[]) => void;
    texSubImage2D: (...args: unknown[]) => void;
  };
  const toNativeImage = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const source = value as {
      width?: number;
      height?: number;
      getPremultipliedRgbaPixels?: () => Uint8Array;
      data?: Uint8Array | Uint8ClampedArray;
    };
    if (!source.width || !source.height) {
      return value;
    }

    // Canvas-backed resources already expose normalized top-down pixels.
    // Prefer this API when both it and `data` exist; using the raw data
    // first can flip a sprite twice during its initial upload.
    if (source.getPremultipliedRgbaPixels) {
      return Image.fromPixels(
        source.width,
        source.height,
        32,
        Buffer.from(source.getPremultipliedRgbaPixels()),
      );
    }

    // Pixi 7 ImageResource's native image data is bottom-up in this GL
    // bridge, so reverse only this fallback path. Canvas text never uses it.
    if (!source.data) {
      const imageCanvas = new NodeCanvas(source.width, source.height);
      const context = imageCanvas.getContext("2d") as {
        drawImage?: (image: unknown, x: number, y: number, width: number, height: number) => void;
      };
      if (!context.drawImage) return value;
      context.drawImage(value, 0, 0, source.width, source.height);
      return Image.fromPixels(
        source.width,
        source.height,
        32,
        Buffer.from(imageCanvas.getPremultipliedRgbaPixels()),
      );
    }
    const imageCanvas = new NodeCanvas(source.width, source.height);
    const context = imageCanvas.getContext("2d") as {
      createImageData(width: number, height: number): ImageData;
      putImageData(imageData: ImageData, x: number, y: number): void;
    };
    const imageData = context.createImageData(source.width, source.height);
    copyRgbaRowsFlippedY(
      imageData.data,
      source.data,
      source.width,
      source.height,
    );
    context.putImageData(imageData, 0, 0);
    return Image.fromPixels(
      source.width,
      source.height,
      32,
      Buffer.from(imageCanvas.getPremultipliedRgbaPixels()),
    );
  };
  mutableWebgl.bufferSubData = (target, _offset, data): void => {
    const typedData = data as ArrayBufferView & {
      slice?: (start: number, end?: number) => ArrayBufferView;
      length?: number;
    };
    const compactData =
      typedData.slice && typedData.length !== undefined
        ? typedData.slice(0, typedData.length)
        : data;
    nativeBufferData(target, compactData, webgl.DYNAMIC_DRAW);
  };
  mutableWebgl.texImage2D = (...args: unknown[]): void => {
    if (args.length === 6) args[5] = toNativeImage(args[5]);
    if (args.length === 9) args[8] = toNativeImage(args[8]);
    nativeTexImage2D(...args);
  };
  mutableWebgl.texSubImage2D = (...args: unknown[]): void => {
    if (args.length === 7) args[6] = toNativeImage(args[6]);
    if (args.length === 9) args[8] = toNativeImage(args[8]);
    nativeTexSubImage2D(...args);
  };

  const app = new Application({
    view: canvas as never,
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    antialias: true,
    autoStart: false,
    backgroundColor: 0x101544,
  });
  const modalFrameListeners = new Set<() => void>();

  const nativeWindow = require("../../../native/window") as {
    create(
      nativeData: Uint8Array,
      onFrame: () => void,
      onState: (active: boolean) => void,
    ): { detach(): void };
  };
  const modalController = nativeWindow.create(
    window.nativeWindowData,
    () => {
      for (const listener of [...modalFrameListeners]) listener();
      app.ticker.update(performance.now());
    },
    () => undefined,
  );

  window.on("resize", () => {
    canvas.resize(window.pixelWidth, window.pixelHeight);
    app.renderer.resize(window.pixelWidth, window.pixelHeight);
  });

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    modalController.detach();
    app.destroy(true, { children: true, texture: false, baseTexture: false });
    window.destroy();
  };

  return {
    app,
    native: {
      window,
      canvas,
      input: {
        dispatchCanvasEvent: (type, event) => canvas.dispatchNativeEvent(type, event),
        dispatchGlobalEvent: (type, event) => adapter.dispatchGlobalEvent(type, event),
      },
      addModalFrameListener: (listener) => {
        modalFrameListeners.add(listener);
        return () => modalFrameListeners.delete(listener);
      },
      swap: () => window.swapBuffers(),
      destroy,
    },
  };
}
