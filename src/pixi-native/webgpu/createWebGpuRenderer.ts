import { Application, DOMAdapter, VERSION } from "pixi.js";
import { Image } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { NodeDOMAdapter, normalizeRefreshRate } from "../NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "../NodeGPUCanvas.ts";
import { NodeGLCanvas } from "../NodeGLCanvas.ts";
import { NodeGLWindow } from "../NodeGLWindow.ts";
import { NodeCanvas } from "../NodeCanvas.ts";
import type {
  NodeGPUApi,
  NodeGPUInstance,
  NodeWindowRenderer,
  NodeNativeInput,
  NodeRenderSurface,
  NodeWindowHandle,
} from "../nativeTypes.ts";
import { resolveGpuBackend } from "../platform.ts";
import {
  getReusableUploadBuffer,
  prepareRgbaPixelsForUpload,
  type RgbaUploadFormat,
} from "../rgbaUpload.ts";
import * as sdl from "@kmamal/sdl";
import { normalizeGpuBindGroupIndex } from "../gpuCompatibility.ts";
import { setNativeVideoModalState } from "../video/NativeVideo.ts";
import {
  createCompositorFrameWaiter,
  createModalFrameController,
  setNativeWindowTransparent,
} from "../ModalFrameController.ts";
import {
  getWindowOptionsDiagnostics,
  NATIVE_BACKGROUND_COLOR,
  premultiplyBackgroundColor,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
  resolveWebGpuAntialiasSamples,
} from "../windowOptions.ts";

const require = createRequire(import.meta.url);

import type { NodeRendererOptions } from "../nativeTypes.ts";
import type { NodeRendererContext } from "../createPixiRenderer.ts";

export async function createWebGpuRenderer(
  options: NodeRendererOptions = {},
): Promise<{ app: Application; native: NodeRendererContext }> {
  const windowOptions = resolveNodeRendererOptions(
    options,
    "PixiJS 8 Native Node WebGPU",
  );
  const webGpuAntialiasSamples = resolveWebGpuAntialiasSamples(
    windowOptions.antialiasSamples,
  );

  const window = sdl.video.createWindow({
    title: windowOptions.title,
    width: windowOptions.width,
    height: windowOptions.height,
    resizable: windowOptions.resizable,
    borderless: windowOptions.borderless,
    x: windowOptions.x,
    y: windowOptions.y,
    webgpu: true,
  });

  setNativeWindowTransparent(
    (window as unknown as { _native: { gpu: Uint8Array } })._native.gpu,
    windowOptions.transparent,
  );

  const gpu = require("../../../native/gpu") as NodeGPUApi;
  const backend = resolveGpuBackend();
  const presentMode = windowOptions.vsync ? "fifo" : "immediate";
  const gpuContext = gpu.createWindowContext({
    flags: [`backend=${backend}`, "verbose=1"],
    window,
    presentMode,
    alphaMode: windowOptions.transparent ? "premultiplied" : "opaque",
  });
  const instance = gpuContext.gpu;
  const adapter = gpuContext.adapter;
  const device = gpuContext.device;
  const renderer = gpuContext.renderer;

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
      | { resource?: PixelResource }
      | PixelResource
      | undefined;
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

  const canvas = new NodeGPUCanvas(
    renderer,
    window.pixelWidth,
    window.pixelHeight,
  );

  const refreshRateHz = normalizeRefreshRate(window.display.frequency);
  const waitForPresent = windowOptions.vsync
    ? createCompositorFrameWaiter()
    : undefined;
  const domAdapter = new NodeDOMAdapter(
    instance,
    resolveAnimationFrameRate(windowOptions, refreshRateHz),
    waitForPresent,
  );
  domAdapter.installPixi8(DOMAdapter);
  const modalController = createModalFrameController(
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
    background: premultiplyBackgroundColor(
      NATIVE_BACKGROUND_COLOR,
      windowOptions.backgroundAlpha,
    ),
    backgroundAlpha: windowOptions.backgroundAlpha,
    resolution: 1,
    antialias: webGpuAntialiasSamples !== 0,
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
    presentMode,
    format: renderer.getPreferredFormat(),
    size: [canvas.width, canvas.height],
    devicePixelRatio: 1,
    refreshRateHz,
    adapter: adapter.info?.device ?? adapter.info?.description ?? "unknown",
    ...getWindowOptionsDiagnostics(windowOptions, window),
  });

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    rgbaUploadBuffers.clear();
    modalController.detach();
    domAdapter.dispose();
    renderer.destroy();
    device.destroy();

    if (!window.destroyed) {
      window.destroy();
    }

    gpu.destroy(gpuContext);
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
