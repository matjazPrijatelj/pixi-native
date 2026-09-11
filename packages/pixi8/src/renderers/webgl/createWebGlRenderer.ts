import { Application, DOMAdapter, VERSION } from "pixi.js";
import { Image as CanvasImage } from "@napi-rs/canvas";

import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import { createNodeSdlWebGLSurface } from "@pixi-native/core/renderers/webgl/NodeSdlWebGLSurface.js";
import { installWebGlImageUploadAdapter } from "@pixi-native/core/renderers/webgl/webglImageUpload.js";
import type { NodeRendererContext } from "../../createPixiRenderer.ts";
import type { NodeRendererOptions } from "@pixi-native/core/runtime/nativeTypes.js";
import { setNativeVideoModalState } from "@pixi-native/core/video/NativeVideo.js";
import {
  createModalFrameController,
  syncNativeWindowSize,
} from "@pixi-native/core/runtime/ModalFrameController.js";
import {
  getWindowOptionsDiagnostics,
  NATIVE_BACKGROUND_COLOR,
  premultiplyBackgroundColor,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
} from "@pixi-native/core/runtime/windowOptions.js";

export async function createWebGlRenderer(
  options: NodeRendererOptions = {},
): Promise<{
  app: Application;
  native: NodeRendererContext;
}> {
  const selectedBackend = "webgl" as const;

  const windowOptions = resolveNodeRendererOptions(
    options,
    "PixiJS 8 Native Node WebGL",
  );
  try {
    const surface = await createNodeSdlWebGLSurface(windowOptions, "WebGL");
    const {
      window,
      nativeWindowData,
      canvas,
      renderer,
      webgl,
      antialiasSamples,
      webglRenderingContextConstructor,
    } = surface;
    installWebGlImageUploadAdapter(webgl);

    const domAdapter = new NodeDOMAdapter(
      null,
      resolveAnimationFrameRate(windowOptions, window.display.frequency),
      undefined,
      webgl,
      CanvasImage as unknown as new () => { src: string },
      webglRenderingContextConstructor,
    );

    domAdapter.installPixi8(DOMAdapter);

    const app = new Application();
    const modalFrameListeners = new Set<() => void>();

    await app.init({
      preference: ["webgl"],
      canvas: canvas as never,
      width: canvas.width,
      height: canvas.height,
      background: premultiplyBackgroundColor(
        NATIVE_BACKGROUND_COLOR,
        windowOptions.backgroundAlpha,
      ),
      backgroundAlpha: windowOptions.backgroundAlpha,
      resolution: 1,
      antialias: antialiasSamples !== 0,
      autoStart: false,
    } as never);

    if (app.renderer.name !== "webgl") {
      app.destroy(true);
      renderer.destroy();
      window.destroy();

      throw new Error(`WebGL is required; Pixi selected ${app.renderer.name}`);
    }

    const resizeToWindow = (dispatchResize: boolean): boolean =>
      syncNativeWindowSize(
        window,
        canvas,
        (width, height) => app.renderer.resize(width, height),
        dispatchResize
          ? () => domAdapter.dispatchGlobalEvent("resize", new Event("resize"))
          : undefined,
      );

    const modalController = createModalFrameController(
      nativeWindowData,
      () => {
        resizeToWindow(true);
        for (const listener of [...modalFrameListeners]) listener();
        domAdapter.dispatchModalFrame(performance.now());
      },
      setNativeVideoModalState,
    );

    window.on("resize", () => resizeToWindow(false));

    console.log({
      pixi: VERSION,
      renderer: app.renderer.name,
      backend: selectedBackend,
      size: [canvas.width, canvas.height],
      ...getWindowOptionsDiagnostics(windowOptions, window),
      actualAntialiasSamples: antialiasSamples,
    });

    let destroyed = false;

    const destroy = (): void => {
      if (destroyed) {
        return;
      }

      destroyed = true;

      modalController.detach();
      domAdapter.dispose();
      renderer.destroy();
      if (!window.destroyed) {
        window.destroy();
      }
    };

    return {
      app,
      native: {
        gpu: null,
        adapter: null,
        device: null,
        window,
        renderer,
        canvas,
        backend: selectedBackend,
        input: {
          dispatchCanvasEvent: (type, event) =>
            canvas.dispatchNativeEvent(type, event),

          dispatchGlobalEvent: (type, event) =>
            domAdapter.dispatchGlobalEvent(type, event),
        },
        addModalFrameListener: (listener) => {
          modalFrameListeners.add(listener);
          return () => modalFrameListeners.delete(listener);
        },
        destroy,
      },
    };
  } catch (error) {
    throw new Error(
      "WebGL backend is unavailable through SDL and webgl-node/native-gles.",
      { cause: error },
    );
  }
}
