import { createRequire } from "node:module";

import { Image } from "@napi-rs/canvas";
import * as sdl from "@kmamal/sdl";
import { Application, VERSION } from "pixi.js";

import { NodeCanvas } from "../pixi-native/NodeCanvas.ts";
import {
  NodeDOMAdapter,
  normalizeRefreshRate,
} from "../pixi-native/NodeDOMAdapter.ts";
import { NodeGLCanvas } from "../pixi-native/NodeGLCanvas.ts";
import { NodeGLWindow } from "../pixi-native/NodeGLWindow.ts";
import { NodeGPUCanvas } from "../pixi-native/NodeGPUCanvas.ts";
import type { NodeRendererContext } from "../pixi-native/createPixiRenderer.ts";
import { normalizeGpuBindGroupIndex } from "../pixi-native/gpuCompatibility.ts";
import type {
  NodeGPUApi,
  NodeGPUInstance,
  NodeNativeInput,
  NodeRendererOptions,
  NodeRenderSurface,
  NodeWindowHandle,
  NodeWindowRenderer,
} from "../pixi-native/nativeTypes.ts";
import { resolveGpuBackend } from "../pixi-native/platform.ts";
import {
  getReusableUploadBuffer,
  prepareRgbaPixelsForUpload,
  type RgbaUploadFormat,
} from "../pixi-native/rgbaUpload.ts";
import { setNativeVideoModalState } from "../pixi-native/video/NativeVideo.ts";

const require = createRequire(import.meta.url);

export async function createWebGlRenderer(
  options: NodeRendererOptions = {},
): Promise<{
  app: Application;
  native: NodeRendererContext;
}> {
  const selectedBackend = "webgl" as const;

  const title = options.title ?? "PixiJS 8 Native Node WebGL";
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const resizable = options.resizable ?? true;
  const vsync = options.vsync ?? true;
  const isGles3 = true;

  try {
    const { init, gl: webgl, Image } = await import("@node-3d/core");
    const { glfw } = await import("@node-3d/glfw");

    const { doc } = init({
      title,
      width,
      height,
      resizable,
      vsync,
      isGles3,
      isWebGL2: true,
      autoEsc: true,
    });

    const window = new NodeGLWindow(doc as never, glfw.pollEvents);

    const nativeTexImage2D = webgl.texImage2D.bind(webgl) as (
      ...args: unknown[]
    ) => void;

    const nativeTexSubImage2D = webgl.texSubImage2D.bind(webgl) as (
      ...args: unknown[]
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
        return value;
      }

      return Image.fromPixels(
        canvas.width,
        canvas.height,
        32,
        Buffer.from(canvas.getPremultipliedRgbaPixels()),
      );
    };

    const mutableWebgl = webgl as unknown as {
      texImage2D: (...args: unknown[]) => void;
      texSubImage2D: (...args: unknown[]) => void;
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

      shaderWebgl.shaderSource = (
        shader: unknown,
        source: string,
      ): void => {
        const glEsSource = source.startsWith("#version")
          ? source.replace(
              /^#version[^\n]*\n/u,
              (header) => `${header}#define GL_ES\n`,
            )
          : `#define GL_ES\n${source}`;

        normalizedShaderSource(shader, glEsSource);
      };
    }

    const createElement = doc.createElement.bind(doc);

    doc.createElement = ((name: string) => {
      const tagName = name.toLowerCase();

      if (tagName === "canvas") {
        return new NodeCanvas();
      }

      if (
        tagName === "div" ||
        tagName === "a" ||
        tagName === "button"
      ) {
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

            if (children) {
              parent!.children = children.filter(
                (child) => child !== element,
              );
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

    const canvas = new NodeGLCanvas(
      webgl,
      window.pixelWidth,
      window.pixelHeight,
    );

    const renderer: NodeRenderSurface = {
      resize: (width, height) => canvas.resize(width, height),
      swap: () => window.drawWindow(() => undefined),
      destroy: () => undefined,
    };

    const domAdapter = new NodeDOMAdapter(
      null,
      window.display.frequency,
      undefined,
      webgl,
      Image as unknown as new () => { src: string },
      webgl.WebGLRenderingContext,
    );

    domAdapter.install();

    const app = new Application();

    await app.init({
      preference: ["webgl"],
      canvas: doc as never,
      width: canvas.width,
      height: canvas.height,
      background: 0x101544,
      resolution: 1,
      antialias: true,
      autoStart: false,
    } as never);

    if (app.renderer.name !== "webgl") {
      app.destroy(true);
      renderer.destroy();
      window.destroy();

      throw new Error(
        `WebGL is required; Pixi selected ${app.renderer.name}`,
      );
    }

    window.on("resize", () => {
      canvas.resize(window.pixelWidth, window.pixelHeight);

      app.renderer.resize(
        window.pixelWidth,
        window.pixelHeight,
      );
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

      renderer.destroy();
      window.destroy();
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
        destroy,
      },
    };
  } catch (error) {
    throw new Error(
      "WebGL backend is unavailable. Install the optional @node-3d/core package.",
      { cause: error },
    );
  }
}
