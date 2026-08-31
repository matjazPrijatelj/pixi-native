import { Application, VERSION } from "pixi.js";
import { Image } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import {
  NodeDOMAdapter,
  normalizeRefreshRate,
} from "./NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "./NodeGPUCanvas.ts";
import { NodeCanvas } from "./NodeCanvas.ts";
import type {
  NodeGPUApi,
  NodeGPUInstance,
  NodeWindowRenderer,
} from "./nativeTypes.ts";
import { resolveGpuBackend } from "./platform.ts";
import {
  getReusableUploadBuffer,
  prepareRgbaPixelsForUpload,
  type RgbaUploadFormat,
} from "./rgbaUpload.ts";
import * as sdl from "@kmamal/sdl";
import type { Sdl } from "@kmamal/sdl";
import { normalizeGpuBindGroupIndex } from "./gpuCompatibility.ts";

const require = createRequire(import.meta.url);
const gpu = require("../../native/gpu") as NodeGPUApi;

export interface NodeRendererContext {
  readonly gpu: NodeGPUInstance;
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly window: Sdl.Video.Window;
  readonly renderer: NodeWindowRenderer;
  readonly canvas: NodeGPUCanvas;
  readonly destroy: () => void;
}

export async function createPixiRenderer(): Promise<{
  app: Application;
  native: NodeRendererContext;
}> {
  const window = sdl.video.createWindow({
    title: "PixiJS 8 Native Node WebGPU",
    width: 1280,
    height: 720,
    resizable: true,
    webgpu: true,
  });

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
      premultipliedPixels ??
      context.getImageData(0, 0, width, height).data;
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
  new NodeDOMAdapter(instance, refreshRateHz, waitForPresent).install();

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
      destroy,
    },
  };
}
