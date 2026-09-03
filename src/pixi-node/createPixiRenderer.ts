import { Application, VERSION } from "pixi.js";
import { Image } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { NodeDOMAdapter, normalizeRefreshRate } from "./NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "./NodeGPUCanvas.ts";
import { NodeGLCanvas } from "./NodeGLCanvas.ts";
import { NodeGLWindow } from "./NodeGLWindow.ts";
import { NodeCanvas } from "./NodeCanvas.ts";
import type {
  NodeGPUApi,
  NodeGPUInstance,
  NodeWindowRenderer,
  NodeNativeInput,
  NodeRenderSurface,
  NodeWindowHandle,
} from "./nativeTypes.ts";
import { resolveGpuBackend } from "./platform.ts";
import {
  getReusableUploadBuffer,
  prepareRgbaPixelsForUpload,
  type RgbaUploadFormat,
} from "./rgbaUpload.ts";
import * as sdl from "@kmamal/sdl";
import { normalizeGpuBindGroupIndex } from "./gpuCompatibility.ts";
import { setNativeVideoModalState } from "./video/NativeVideo.ts";

const require = createRequire(import.meta.url);

export interface NodeRendererContext {
  readonly gpu: NodeGPUInstance | null;
  readonly adapter: GPUAdapter | null;
  readonly device: GPUDevice | null;
  readonly window: NodeWindowHandle;
  readonly renderer: NodeRenderSurface;
  readonly canvas: NodeGPUCanvas | NodeGLCanvas;
  readonly backend: "webgpu" | "webgl";
  readonly input: NodeNativeInput;
  readonly destroy: () => void;
}

export async function createPixiRenderer(): Promise<{
  app: Application;
  native: NodeRendererContext;
}> {
  const requestedBackend = process.env.PIXI_RENDERER?.trim().toLowerCase();
  const selectedBackend: "webgpu" | "webgl" =
    requestedBackend === "webgl" ? "webgl" : "webgpu";
  if (selectedBackend === "webgl") {
    try {
      const { init, gl: webgl, Image } = await import("@node-3d/core");
      const { glfw } = await import("@node-3d/glfw");
      const { doc } = init({
        title: "PixiJS 8 Native Node WebGL",
        width: 1280,
        height: 720,
        resizable: true,
        vsync: true,
        isGles3: false,
        isWebGL2: true,
        autoEsc: false,
      });
      const window = new NodeGLWindow(doc as never, glfw.pollEvents);
      const nativeTexImage2D = webgl.texImage2D.bind(webgl) as (...args: unknown[]) => void;
      const nativeTexSubImage2D = webgl.texSubImage2D.bind(webgl) as (...args: unknown[]) => void;
      const toNativeImage = (value: unknown): unknown => {
        if (!value || typeof value !== "object") return value;
        const canvas = value as {
          width?: number;
          height?: number;
          getPremultipliedRgbaPixels?: () => Uint8Array;
        };
        if (!canvas.getPremultipliedRgbaPixels || !canvas.width || !canvas.height) {
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
        if (args.length === 9) args[8] = toNativeImage(args[8]);
        if (args.length === 6) args[5] = toNativeImage(args[5]);
        nativeTexImage2D(...args);
      };
      mutableWebgl.texSubImage2D = (...args: unknown[]): void => {
        if (args.length === 9) args[8] = toNativeImage(args[8]);
        if (args.length === 7) args[6] = toNativeImage(args[6]);
        nativeTexSubImage2D(...args);
      };
      const normalizedShaderSource = webgl.shaderSource.bind(webgl) as
        (shader: unknown, source: string) => void;
      const shaderWebgl = webgl as unknown as {
        shaderSource: (shader: unknown, source: string) => void;
      };
      shaderWebgl.shaderSource = (shader: unknown, source: string): void => {
        const glEsSource = source.startsWith("#version")
          ? source.replace(/^#version[^\n]*\n/u, (header) => `${header}#define GL_ES\n`)
          : `#define GL_ES\n${source}`;
        normalizedShaderSource(shader, glEsSource);
      };
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
              const children = parent?.children as Record<string, unknown>[] | undefined;
              if (children) parent!.children = children.filter((child) => child !== element);
              element.parentNode = null;
            },
            addEventListener() {},
            removeEventListener() {},
          };
          return element;
        }
        return createElement(name);
      }) as never;
      const canvas = new NodeGLCanvas(webgl, window.pixelWidth, window.pixelHeight);
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
        throw new Error(`WebGL is required; Pixi selected ${app.renderer.name}`);
      }
      window.on("resize", () => {
        canvas.resize(window.pixelWidth, window.pixelHeight);
        app.renderer.resize(window.pixelWidth, window.pixelHeight);
      });
      console.log({ pixi: VERSION, renderer: app.renderer.name, backend: selectedBackend,
        size: [canvas.width, canvas.height] });
      let destroyed = false;
      const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        renderer.destroy();
        window.destroy();
      };
      return { app, native: { gpu: null, adapter: null, device: null, window, renderer, canvas,
        backend: selectedBackend, input: {
          dispatchCanvasEvent: (type, event) => canvas.dispatchNativeEvent(type, event),
          dispatchGlobalEvent: (type, event) => domAdapter.dispatchGlobalEvent(type, event),
        }, destroy } };
    } catch (error) {
      throw new Error(
        "WebGL backend is unavailable. Install the optional @node-3d/core package.",
        { cause: error },
      );
    }
  }

  const window = sdl.video.createWindow({
    title: "PixiJS 8 Native Node WebGPU", width: 1280, height: 720,
    resizable: true, webgpu: true,
  });

  const gpu = require("../../native/gpu") as NodeGPUApi;
  const nativeWindow = require("../../native/window") as {
    create(
      nativeData: Uint8Array,
      onFrame: () => void,
      onState: (active: boolean) => void,
    ): { detach(): void };
  };
  const backend = resolveGpuBackend();
  const instance = gpu.create([`backend=${backend}`, "verbose=1"]);
  const adapter = await instance.requestAdapter();
  if (!adapter)
    throw new Error("native GPU addon could not provide a WebGPU adapter");

  const device = await adapter.requestDevice();

  const queue = device.queue as any;
  const rgbaUploadBuffers = new Map<number, Uint8Array>();
  const nativeCopyExternalImageToTexture =
    queue.copyExternalImageToTexture?.bind(queue);

  queue.copyExternalImageToTexture = ((
    sourceInfo: { source?: unknown },
    destination: GPUImageCopyTexture & { premultipliedAlpha?: boolean },
    copySize: GPUExtent3D,
  ) => {
    type PixelResource = {
      width?: number;
      height?: number;
      getContext?: (type: string) => unknown;
      getPremultipliedRgbaPixels?: () => Uint8Array;
    };
    const source = sourceInfo?.source as
      { resource?: PixelResource } | PixelResource | undefined;
    let resource = (
      source && "resource" in source ? source.resource : source
    ) as PixelResource | undefined;

    let context = resource?.getContext?.("2d") as
      | {
          drawImage?: (image: unknown, x: number, y: number) => void;
          getImageData?: (
            x: number,
            y: number,
            width: number,
            height: number,
          ) => { data: Uint8Array };
        }
      | undefined;

    const width = Math.max(
      1,
      Number(resource?.width ?? (copySize as GPUExtent3DDict).width ?? 1),
    );

    const height = Math.max(
      1,
      Number(resource?.height ?? (copySize as GPUExtent3DDict).height ?? 1),
    );

    if (!context?.getImageData && resource instanceof Image) {
      const image = resource;
      const pixelCanvas = new NodeCanvas(width, height);
      resource = pixelCanvas;
      context = pixelCanvas.getContext("2d") as typeof context;
      context?.drawImage?.(image, 0, 0);
    }

    if (!context?.getImageData) {
      if (!nativeCopyExternalImageToTexture)
        throw new Error("Native image source cannot provide RGBA pixels");
      return nativeCopyExternalImageToTexture(
        sourceInfo,
        destination,
        copySize,
      );
    }

    const premultiplyAlpha = destination.premultipliedAlpha === true;
    const premultipliedPixels = premultiplyAlpha
      ? resource?.getPremultipliedRgbaPixels?.()
      : undefined;
    const canvasPixels =
      premultipliedPixels ?? context.getImageData(0, 0, width, height).data;
    const format = destination.texture.format;
    if (
      format !== "rgba8unorm" &&
      format !== "rgba8unorm-srgb" &&
      format !== "bgra8unorm" &&
      format !== "bgra8unorm-srgb"
    ) {
      throw new Error(
        `Native Canvas upload does not support ${format} textures`,
      );
    }
    const requiresStagingBuffer =
      format === "bgra8unorm" ||
      format === "bgra8unorm-srgb" ||
      (premultiplyAlpha && !premultipliedPixels);
    const pixels = prepareRgbaPixelsForUpload(
      canvasPixels,
      format as RgbaUploadFormat,
      premultiplyAlpha && !premultipliedPixels,
      requiresStagingBuffer
        ? getReusableUploadBuffer(rgbaUploadBuffers, canvasPixels.byteLength)
        : undefined,
    );
    queue.writeTexture(
      destination,
      pixels,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
  }) as typeof queue.copyExternalImageToTexture;

  const renderer = gpu.renderGPUDeviceToWindow({
    device,
    window,
    presentMode: "fifo",
  });

  const canvas = new NodeGPUCanvas(
    renderer,
    window.pixelWidth,
    window.pixelHeight,
  );

  const refreshRateHz = normalizeRefreshRate(window.display.frequency);
  const waitForPresent =
    process.platform === "win32" && renderer.waitForPresent
      ? renderer.waitForPresent.bind(renderer)
      : undefined;
  const domAdapter = new NodeDOMAdapter(
    instance,
    refreshRateHz,
    waitForPresent,
  );
  domAdapter.install();
  const modalController = nativeWindow.create(
    (window as any)._native.gpu,
    () => {
      domAdapter.dispatchModalFrame(performance.now());
    },
    (active) => {
      setNativeVideoModalState(active);
    },
  );

  const app = new Application();
  await app.init({
    preference: ["webgpu"],
    canvas: canvas as never,
    width: canvas.width,
    height: canvas.height,
    background: 0x101544,
    resolution: 1,
    antialias: true,
    autoStart: false,
    gpu: {
      adapter,
      device,
    },
  } as never);

  if (app.renderer.name !== "webgpu") {
    app.destroy(true);
    throw new Error(`WebGPU is required; Pixi selected ${app.renderer.name}`);
  }

  const ensureRootStencilAttachment = (): void => {
    // Graphics masks use Pixi's stencil pipeline. The canvas root target does
    // not allocate a stencil attachment unless it is requested explicitly.
    const rootRenderTarget = app.renderer.view.renderTarget;
    rootRenderTarget.ensureDepthStencilTexture();
    const depthStencilTexture = rootRenderTarget.depthStencilTexture;
    if (
      !rootRenderTarget.stencil ||
      depthStencilTexture?.format !== "depth24plus-stencil8"
    ) {
      throw new Error(
        `[Pixi WebGPU] root stencil attachment unavailable (stencil=${rootRenderTarget.stencil}, format=${depthStencilTexture?.format ?? "none"})`,
      );
    }
  };

  ensureRootStencilAttachment();

  // Pixi 8.20 enumerates custom shader groups with `for...in`, so the group
  // index reaches the strict native Dawn binding as a string. Browser WebGPU
  // coerces it, while the Node binding correctly requires a number.
  const encoder = (
    app.renderer as unknown as {
      encoder: {
        setBindGroup(
          index: number | string,
          bindGroup: unknown,
          program: unknown,
        ): void;
      };
    }
  ).encoder;
  const setBindGroup = encoder.setBindGroup.bind(encoder);
  encoder.setBindGroup = (index, bindGroup, program): void => {
    setBindGroup(normalizeGpuBindGroupIndex(index), bindGroup, program);
  };

  window.on("resize", () => {
    canvas.resize(window.pixelWidth, window.pixelHeight);
    app.renderer.resize(window.pixelWidth, window.pixelHeight);
    ensureRootStencilAttachment();
  });

  console.log({
    pixi: VERSION,
    renderer: app.renderer.name,
    backend,
    format: renderer.getPreferredFormat(),
    size: [canvas.width, canvas.height],
    devicePixelRatio: 1,
    refreshRateHz,
    adapter: adapter.info?.device ?? adapter.info?.description ?? "unknown",
  });

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    rgbaUploadBuffers.clear();
    modalController.detach();
    renderer.destroy();
    device.destroy();

    if (!window.destroyed) {
      window.destroy();
    }

    gpu.destroy(instance);
  };

  return {
    app,
    native: {
      gpu: instance,
      adapter,
      device,
      window,
      renderer,
      canvas,
      backend: "webgpu",
      input: {
        dispatchCanvasEvent: (type, event) =>
          canvas.dispatchNativeEvent(type, event),
        dispatchGlobalEvent: (type, event) =>
          domAdapter.dispatchGlobalEvent(type, event),
      },
      destroy,
    },
  };
}
