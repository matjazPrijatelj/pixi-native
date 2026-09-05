import { Image as CanvasImage } from "@napi-rs/canvas";
import { Application, VERSION } from "pixi.js";

import { NodeCanvas } from "../NodeCanvas.ts";
import { NodeDOMAdapter, normalizeRefreshRate } from "../NodeDOMAdapter.ts";
import { NodeGLCanvas } from "../NodeGLCanvas.ts";
import { NodeGLWindow } from "../NodeGLWindow.ts";
import type { NodeRendererContext } from "../createPixiRenderer.ts";
import type {
  NodeRendererOptions,
  NodeRenderSurface,
  NodeWindowHandle,
} from "../nativeTypes.ts";
import { copyRgbaRowsFlippedY } from "../rgbaUpload.ts";
import { setNativeVideoModalState } from "../video/NativeVideo.ts";
import { sliceWebGlBufferData } from "../webglBufferUpload.ts";
import { installWebGlImageUploadAdapter } from "../webglImageUpload.ts";
import { createModalFrameController } from "../ModalFrameController.ts";
import {
  NATIVE_BACKGROUND_COLOR,
  premultiplyBackgroundColor,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
} from "../windowOptions.ts";
import {
  assertGlfwTransparency,
  requestGlfwTransparency,
} from "../glfwTransparency.ts";

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
  const isGles3 = true;

  try {
    let window: NodeWindowHandle;
    let nativeWindowData: Uint8Array;
    let canvas: NodeGLCanvas;
    let renderer: NodeRenderSurface;
    let pixiCanvas: unknown;
    let webgl: any;
    let imageConstructor: new () => { src: string };
    let webglRenderingContextConstructor: { readonly prototype: object };
    const usesWindowsAngle = process.platform === "win32";

    if (usesWindowsAngle) {
      const { createWindowsAngleWebGLSurface } = await import(
        "../WindowsAngleWebGL.ts"
      );
      const angle = await createWindowsAngleWebGLSurface(windowOptions);
      window = angle.window;
      nativeWindowData = angle.nativeWindowData;
      canvas = angle.canvas;
      renderer = angle.renderer;
      pixiCanvas = canvas;
      webgl = angle.webgl;
      installWebGlImageUploadAdapter(webgl);
      imageConstructor = CanvasImage as unknown as new () => { src: string };
      webglRenderingContextConstructor = angle.webglRenderingContextConstructor;
    } else {
      const { init, gl, Image } = await import("@node-3d/core");
      const { glfw } = await import("@node-3d/glfw");
      const { doc } = init({
        title: windowOptions.title,
        width: windowOptions.width,
        height: windowOptions.height,
        resizable: windowOptions.resizable,
        decorated: !windowOptions.borderless,
        vsync: windowOptions.vsync,
        isGles3,
        isWebGL2: true,
        autoEsc: true,
        onBeforeWindow: (_window: unknown, rawGlfw: unknown) => {
          requestGlfwTransparency(rawGlfw, windowOptions.transparent);
        },
      });
      assertGlfwTransparency(glfw, doc.handle, windowOptions.transparent);
      const glfwWindow = new NodeGLWindow(doc as never, {
        pollEvents: glfw.pollEvents,
        maximize: () => glfw.maximizeWindow(doc.handle),
      });
      if (windowOptions.x !== undefined && windowOptions.y !== undefined) {
        glfwWindow.setPosition(windowOptions.x, windowOptions.y);
      }
      window = glfwWindow;
      nativeWindowData = glfwWindow.nativeWindowData;
      webgl = gl;
      imageConstructor = Image as unknown as new () => { src: string };
      webglRenderingContextConstructor = gl.WebGLRenderingContext;

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
              const parent = element.parentNode as Record<
                string,
                unknown
              > | null;
              const children = parent?.children as
                | Record<string, unknown>[]
                | undefined;
              if (children)
                parent!.children = children.filter(
                  (child) => child !== element,
                );
              element.parentNode = null;
            },
            addEventListener() {},
            removeEventListener() {},
          };
          return element;
        }
        return createElement(name);
      }) as never;

      canvas = new NodeGLCanvas(webgl, window.pixelWidth, window.pixelHeight);
      renderer = {
        resize: (width, height) => canvas.resize(width, height),
        swap: () => glfwWindow.swapBuffers(),
        destroy: () => undefined,
      };
      pixiCanvas = doc;
    }

    if (!usesWindowsAngle) {
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

      if (!isGles3) {
        const normalizedShaderSource = webgl.shaderSource.bind(webgl) as (
          shader: unknown,
          source: string,
        ) => void;

        const shaderWebgl = webgl as unknown as {
          shaderSource: (shader: unknown, source: string) => void;
        };

        shaderWebgl.shaderSource = (shader: unknown, source: string): void => {
          const glEsSource = source.startsWith("#version")
            ? source.replace(
                /^#version[^\n]*\n/u,
                (header) => `${header}#define GL_ES\n`,
              )
            : `#define GL_ES\n${source}`;

          normalizedShaderSource(shader, glEsSource);
        };
      }
    }

    const domAdapter = new NodeDOMAdapter(
      null,
      resolveAnimationFrameRate(windowOptions, window.display.frequency),
      undefined,
      webgl,
      imageConstructor,
      webglRenderingContextConstructor,
    );

    domAdapter.install();

    const app = new Application();
    const modalFrameListeners = new Set<() => void>();

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
      antialias: true,
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
        for (const listener of [...modalFrameListeners]) listener();
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
    const runtime =
      process.platform === "win32"
        ? "webgl-node/native-gles ANGLE"
        : "@node-3d/core and @node-3d/glfw";
    throw new Error(
      `WebGL backend is unavailable through ${runtime}.`,
      { cause: error },
    );
  }
}
