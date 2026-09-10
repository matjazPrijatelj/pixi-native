import { Application, DOMAdapter, VERSION } from "pixi.js";

import { NodeCanvas } from "@pixi-native/core/canvas/NodeCanvas.js";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import { createNodeGlfwWebGLSurface } from "@pixi-native/core/renderers/webgl/NodeGlfwWebGLSurface.js";
import type { NodeRendererContext } from "../../createPixiRenderer.ts";
import type { NodeRendererOptions } from "@pixi-native/core/runtime/nativeTypes.js";
import { copyRgbaRowsFlippedY } from "@pixi-native/core/canvas/rgbaUpload.js";
import { setNativeVideoModalState } from "@pixi-native/core/video/NativeVideo.js";
import { sliceWebGlBufferData } from "@pixi-native/core/renderers/webgl/webglBufferUpload.js";
import { createModalFrameController } from "@pixi-native/core/runtime/ModalFrameController.js";
import { createModalFrameListeners } from "../modalFrameListeners.ts";
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
    const surface = await createNodeGlfwWebGLSurface(windowOptions, "WebGL");
    const {
      window,
      nativeWindowData,
      canvas,
      renderer,
      document: doc,
      webgl,
      imageConstructor,
      webglRenderingContextConstructor,
    } = surface;

    const createElement = doc.createElement.bind(doc);
    doc.createElement = ((name: string) => {
      const tagName = name.toLowerCase();
      if (tagName === "canvas") return new NodeCanvas();
      if (tagName === "div" || tagName === "a" || tagName === "button") {
        const element: Record<string, unknown> = {
          style: {},
          children: [],
          parentNode: null,
          appendChild(child: Record<string, unknown>) {
            child.parentNode = element;
            (element.children as Record<string, unknown>[]).push(child);
            return child;
          },
          remove() {
            const parent = element.parentNode as Record<string, unknown> | null;
            const children = parent?.children as
              | Record<string, unknown>[]
              | undefined;
            if (children) {
              parent!.children = children.filter((child) => child !== element);
            }
            element.parentNode = null;
          },
          addEventListener() {},
          removeEventListener() {},
        };
        return element;
      }
      return createElement(name);
    }) as never;

    const pixiCanvas = doc;
    {
      const LegacyImage = imageConstructor as unknown as {
        fromPixels(
          width: number,
          height: number,
          bitsPerPixel: number,
          pixels: Buffer,
        ): unknown;
      };
      const nativeTexImage2D = webgl.texImage2D.bind(webgl) as (
        ...args: unknown[]
      ) => void;

      const nativeTexSubImage2D = webgl.texSubImage2D.bind(webgl) as (
        ...args: unknown[]
      ) => void;

      const nativeBufferData = webgl.bufferData.bind(webgl) as (
        target: number,
        data: ArrayBufferView,
        usage: number,
      ) => void;

      const toNativeImage = (value: unknown): unknown => {
        if (!value || typeof value !== "object") {
          return value;
        }

        const canvas = value as {
          width?: number;
          height?: number;
          getPremultipliedRgbaPixels?: () => Uint8Array;
        };

        if (
          !canvas.getPremultipliedRgbaPixels ||
          !canvas.width ||
          !canvas.height
        ) {
          const image = value as {
            data?: Uint8Array | Uint8ClampedArray;
          };
          if (!image.data || !canvas.width || !canvas.height) {
            return value;
          }

          const imageCanvas = new NodeCanvas(canvas.width, canvas.height);
          const context = imageCanvas.getContext("2d") as {
            createImageData(width: number, height: number): ImageData;
            putImageData(imageData: ImageData, x: number, y: number): void;
          };
          const imageData = context.createImageData(
            canvas.width,
            canvas.height,
          );
          copyRgbaRowsFlippedY(
            imageData.data,
            image.data,
            canvas.width,
            canvas.height,
          );
          context.putImageData(imageData, 0, 0);
          return LegacyImage.fromPixels(
            canvas.width,
            canvas.height,
            32,
            Buffer.from(imageCanvas.getPremultipliedRgbaPixels()),
          );
        }

        return LegacyImage.fromPixels(
          canvas.width,
          canvas.height,
          32,
          Buffer.from(canvas.getPremultipliedRgbaPixels()),
        );
      };

      const mutableWebgl = webgl as unknown as {
        bufferData: (
          target: number,
          data: ArrayBufferView,
          usage: number,
        ) => void;
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

      mutableWebgl.bufferSubData = (
        target: number,
        _offset: number,
        data: ArrayBufferView,
        _srcOffset?: number,
        _length?: number,
      ): void => {
        const view = data as ArrayBufferView & {
          length?: number;
          slice?: (start: number, end?: number) => ArrayBufferView;
        };
        // Pixi passes the complete logical buffer with a partial-update range.
        // Re-uploading that compact buffer avoids the native partial-upload path,
        // which currently corrupts shared Sprite and BitmapText geometry.
        const compactData =
          view.slice && view.length !== undefined
            ? sliceWebGlBufferData(
                view as Parameters<typeof sliceWebGlBufferData>[0],
              )
            : data;
        nativeBufferData(target, compactData, webgl.DYNAMIC_DRAW);
      };

      mutableWebgl.texImage2D = (...args: unknown[]): void => {
        if (args.length === 9) {
          args[8] = toNativeImage(args[8]);
        }

        if (args.length === 6) {
          args[5] = toNativeImage(args[5]);
        }

        nativeTexImage2D(...args);
      };

      mutableWebgl.texSubImage2D = (...args: unknown[]): void => {
        if (args.length === 9) {
          args[8] = toNativeImage(args[8]);
        }

        if (args.length === 7) {
          args[6] = toNativeImage(args[6]);
        }

        nativeTexSubImage2D(...args);
      };
    }

    const domAdapter = new NodeDOMAdapter(
      null,
      resolveAnimationFrameRate(windowOptions, window.display.frequency),
      undefined,
      webgl,
      imageConstructor,
      webglRenderingContextConstructor,
    );

    domAdapter.installPixi8(DOMAdapter);

    const app = new Application();
    const modalFrameListeners = createModalFrameListeners();

    await app.init({
      preference: ["webgl"],
      canvas: pixiCanvas as never,
      width: canvas.width,
      height: canvas.height,
      background: premultiplyBackgroundColor(
        NATIVE_BACKGROUND_COLOR,
        windowOptions.backgroundAlpha,
      ),
      backgroundAlpha: windowOptions.backgroundAlpha,
      resolution: 1,
      antialias: windowOptions.antialiasSamples !== 0,
      autoStart: false,
    } as never);

    if (app.renderer.name !== "webgl") {
      app.destroy(true);
      renderer.destroy();
      window.destroy();

      throw new Error(`WebGL is required; Pixi selected ${app.renderer.name}`);
    }

    const modalController = createModalFrameController(
      nativeWindowData,
      () => {
        modalFrameListeners.dispatch();
        domAdapter.dispatchModalFrame(performance.now());
      },
      setNativeVideoModalState,
    );

    window.on("resize", () => {
      canvas.resize(window.pixelWidth, window.pixelHeight);

      app.renderer.resize(window.pixelWidth, window.pixelHeight);
    });

    console.log({
      pixi: VERSION,
      renderer: app.renderer.name,
      backend: selectedBackend,
      size: [canvas.width, canvas.height],
      ...getWindowOptionsDiagnostics(windowOptions, window),
    });

    let destroyed = false;

    const destroy = (): void => {
      if (destroyed) {
        return;
      }

      destroyed = true;

      modalFrameListeners.clear();
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
        addModalFrameListener: modalFrameListeners.add,
        destroy,
      },
    };
  } catch (error) {
    throw new Error(
      "WebGL backend is unavailable through @node-3d/core and @node-3d/glfw.",
      { cause: error },
    );
  }
}
