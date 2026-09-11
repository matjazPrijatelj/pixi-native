import { Assets, type Application } from "pixi.js-v7";
import { Image as CanvasImage } from "@napi-rs/canvas";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import { NodeGLCanvas } from "@pixi-native/core/canvas/NodeGLCanvas.js";
import { createNodeSdlWebGLSurface } from "@pixi-native/core/renderers/webgl/NodeSdlWebGLSurface.js";
import { installWebGlImageUploadAdapter } from "@pixi-native/core/renderers/webgl/webglImageUpload.js";
import type {
  NodeNativeInput,
  NodeRendererOptions,
  NodeWindowHandle,
} from "@pixi-native/core/runtime/nativeTypes.js";
import { createModalFrameController } from "@pixi-native/core/runtime/ModalFrameController.js";
import {
  getWindowOptionsDiagnostics,
  NATIVE_BACKGROUND_COLOR,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
} from "@pixi-native/core/runtime/windowOptions.js";
import {
  manageNativeApplication,
  type ManagedNativeApplication,
} from "@pixi-native/core/application/ManagedNativeApplication.js";

export type RendererOptions = NodeRendererOptions;

export type AppOptions = RendererOptions;

/** PixiJS 7 application and manually managed native WebGL context. */
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

let nativeAssetsInitialization: Promise<void> | undefined;

/** Prepares Pixi's browser-facing Assets API for the installed native DOM. */
function initializeNativeAssets(): Promise<void> {
  nativeAssetsInitialization ??= (() => {
    Assets.detections.length = 0;
    return Assets.init({
      skipDetections: true,
      texturePreference: { format: ["png"] },
    });
  })();
  return nativeAssetsInitialization;
}

/**
 * Creates a PixiJS 7 application and native WebGL surface without a managed loop.
 * The caller owns rendering, presentation, event polling, and teardown.
 */
export async function createRenderer(
  options: RendererOptions = {},
): Promise<RendererResult> {
  const windowOptions = resolveNodeRendererOptions(
    options,
    "PixiJS 7 Native Node WebGL",
  );
  const surface = await createNodeSdlWebGLSurface(windowOptions, "WebGL7");
  const {
    window,
    nativeWindowData,
    canvas,
    renderer,
    webgl,
    antialiasSamples,
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
  await initializeNativeAssets();
  installWebGlImageUploadAdapter(webgl);
  {
    const nativeBufferData = webgl.bufferData.bind(webgl) as (
      target: number,
      data: ArrayBufferView,
      usage: number,
    ) => void;
    const mutableWebgl = webgl as unknown as {
      bufferSubData: (
        target: number,
        offset: number,
        data: ArrayBufferView,
        srcOffset?: number,
        length?: number,
      ) => void;
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
  }

  const app = new Application({
    view: canvas as never,
    width: canvas.width,
    height: canvas.height,
    resolution: 1,
    antialias: antialiasSamples !== 0,
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
    actualAntialiasSamples: antialiasSamples,
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

/**
 * Creates a self-running PixiJS 7 application on the native WebGL surface.
 * Native close and process termination use the same idempotent teardown path.
 */
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
