import type { Application } from "pixi.js-v7";
import { Image as CanvasImage } from "@napi-rs/canvas";
import { NodeDOMAdapter } from "../NodeDOMAdapter.ts";
import { NodeGLCanvas } from "../NodeGLCanvas.ts";
import { createNodeGlfwWebGLSurface } from "../NodeGlfwWebGLSurface.ts";
import { NodeCanvas } from "../NodeCanvas.ts";
import { copyRgbaRowsFlippedY } from "../rgbaUpload.ts";
import type {
  NodeNativeInput,
  NodeRendererOptions,
  NodeWindowHandle,
} from "../nativeTypes.ts";
import { createModalFrameController } from "../ModalFrameController.ts";
import {
  getWindowOptionsDiagnostics,
  NATIVE_BACKGROUND_COLOR,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
} from "../windowOptions.ts";
import {
  manageNativeApplication,
  type ManagedNativeApplication,
} from "../ManagedNativeApplication.ts";

export type RendererOptions = NodeRendererOptions;

export type AppOptions = RendererOptions;

export interface RendererResult {
  readonly app: Application;
  readonly native: {
    readonly window: NodeWindowHandle;
    readonly canvas: NodeGLCanvas;
    readonly input: NodeNativeInput;
    readonly addModalFrameListener: (listener: () => void) => () => void;
    readonly swap: () => void;
    readonly destroy: () => void;
  };
}

export type App = ManagedNativeApplication<
  Application,
  RendererResult["native"]
>;

export async function createRenderer(
  options: RendererOptions = {},
): Promise<RendererResult> {
  const windowOptions = resolveNodeRendererOptions(
    options,
    "PixiJS 7 Native Node WebGL",
  );
  const surface = await createNodeGlfwWebGLSurface(windowOptions, "WebGL7");
  const {
    window,
    nativeWindowData,
    canvas,
    renderer,
    webgl,
    imageConstructor: legacyImage,
    webglRenderingContextConstructor,
  } = surface;
  const adapter = new NodeDOMAdapter(
    null,
    resolveAnimationFrameRate(windowOptions, window.display.frequency),
    undefined,
    webgl,
    CanvasImage as unknown as new () => { src: string },
    webglRenderingContextConstructor,
  );
  const { Application, settings, VERSION } = await import("pixi.js-v7");
  adapter.installPixi7(settings);
  {
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
        return legacyImage.fromPixels(
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
          drawImage?: (
            image: unknown,
            x: number,
            y: number,
            width: number,
            height: number,
          ) => void;
        };
        if (!context.drawImage) return value;
        context.drawImage(value, 0, 0, source.width, source.height);
        return legacyImage.fromPixels(
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
      return legacyImage.fromPixels(
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
  }

  const app = new Application({
    view: canvas as never,
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    antialias: windowOptions.antialiasSamples !== 0,
    autoStart: false,
    backgroundColor: NATIVE_BACKGROUND_COLOR,
    backgroundAlpha: windowOptions.backgroundAlpha,
  });
  const modalFrameListeners = new Set<() => void>();

  const modalController = createModalFrameController(
    nativeWindowData,
    () => {
      for (const listener of [...modalFrameListeners]) listener();
      adapter.dispatchModalFrame(performance.now());
    },
    () => undefined,
  );

  window.on("resize", () => {
    canvas.resize(window.pixelWidth, window.pixelHeight);
    app.renderer.resize(window.pixelWidth, window.pixelHeight);
  });

  console.log({
    pixi: VERSION,
    renderer: "webgl",
    backend: "webgl",
    size: [canvas.width, canvas.height],
    ...getWindowOptionsDiagnostics(windowOptions, window),
  });

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    modalController.detach();
    adapter.dispose();
    // The application owner may release Pixi before the native GL surface.
    // Pixi 7 plugin teardown is not idempotent, so never destroy it twice.
    if (app.renderer) {
      app.destroy(true, { children: true, texture: false, baseTexture: false });
    }
    renderer.destroy();
    if (!window.destroyed) {
      window.destroy();
    }
  };

  return {
    app,
    native: {
      window,
      canvas,
      input: {
        dispatchCanvasEvent: (type, event) =>
          canvas.dispatchNativeEvent(type, event),
        dispatchGlobalEvent: (type, event) =>
          adapter.dispatchGlobalEvent(type, event),
      },
      addModalFrameListener: (listener) => {
        modalFrameListeners.add(listener);
        return () => modalFrameListeners.delete(listener);
      },
      swap: () => renderer.swap(),
      destroy,
    },
  };
}

/** Creates a self-running Pixi 7 application on the native WebGL surface. */
export async function createApp(options: AppOptions = {}): Promise<App> {
  const { app, native } = await createRenderer(options);
  return manageNativeApplication({
    app,
    native,
    // The Pixi 7 low-level context owns its non-idempotent Application
    // teardown so the managed path cannot invoke ResizePlugin twice.
    destroyApplication: () => undefined,
  });
}
