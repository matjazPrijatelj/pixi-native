import { Application, VERSION, type TextureSource } from "pixi.js";
import { Image } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { NodeDOMAdapter } from "./NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "./NodeGPUCanvas.ts";
import { NodeTextCanvas } from "./NodeTextCanvas.ts";
import type {
  NodeGPUApi,
  NodeGPUInstance,
  NodeSDLApi,
  NodeSDLWindow,
  NodeWindowRenderer,
} from "./nativeTypes.ts";
import { resolveGpuBackend } from "./platform.ts";

const require = createRequire(import.meta.url);
const gpu = require("../../native/gpu") as NodeGPUApi;
const sdl = require("@kmamal/sdl") as NodeSDLApi;

export interface NodeRendererContext {
  readonly gpu: NodeGPUInstance;
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly window: NodeSDLWindow;
  readonly renderer: NodeWindowRenderer;
  readonly canvas: NodeGPUCanvas;
  readonly uploadRgbaTexture: (
    source: TextureSource,
    data: Uint8Array,
    width: number,
    height: number,
  ) => void;
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
  const nativeCopyExternalImageToTexture =
    queue.copyExternalImageToTexture?.bind(queue);
  queue.copyExternalImageToTexture = ((
    sourceInfo: { source?: unknown },
    destination: GPUImageCopyTexture,
    copySize: GPUExtent3D,
  ) => {
    type PixelResource = {
      width?: number;
      height?: number;
      getContext?: (type: string) => unknown;
    };
    const source = sourceInfo?.source as
      { resource?: PixelResource } | PixelResource | undefined;
    const resource = (
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
      const pixelCanvas = new NodeTextCanvas(width, height);
      context = pixelCanvas.getContext("2d") as typeof context;
      context?.drawImage?.(resource, 0, 0);
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
    const pixels = context.getImageData(0, 0, width, height).data;
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
  new NodeDOMAdapter(instance).install();

  const app = new Application();
  await app.init({
    preference: ["webgpu"],
    canvas: canvas as never,
    width: canvas.width,
    height: canvas.height,
    background: 0x101522,
    resolution: 1,
    antialias: true,
    autoStart: false,
    gpu: { adapter, device },
  } as never);
  if (app.renderer.name !== "webgpu") {
    app.destroy(true);
    throw new Error(`WebGPU is required; Pixi selected ${app.renderer.name}`);
  }
  const textureSystem = app.renderer.texture as unknown as {
    getGpuSource(source: TextureSource): GPUTexture;
  };
  const uploadRgbaTexture = (
    source: TextureSource,
    data: Uint8Array,
    width: number,
    height: number,
  ): void => {
    const expectedBytes = width * height * 4;
    if (data.byteLength !== expectedBytes)
      throw new Error(
        `RGBA video frame has ${data.byteLength} bytes; expected ${expectedBytes}`,
      );
    // Copy the external napi-rs memory once into a V8-owned typed-array view.
    const pixels = new Uint8Array(data);
    const texture = textureSystem.getGpuSource(source);
    device.queue.writeTexture(
      { texture },
      pixels as unknown as GPUAllowSharedBufferSource,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
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
    adapter: adapter.info?.device ?? adapter.info?.description ?? "unknown",
  });
  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
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
      uploadRgbaTexture,
      destroy,
    },
  };
}
