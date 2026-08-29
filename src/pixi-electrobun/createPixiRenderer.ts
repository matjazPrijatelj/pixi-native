import { Application, GpuEncoderSystem, VERSION } from "pixi.js";
import { GpuWindow, webgpu } from "electrobun/main";
import { ElectrobunDOMAdapter } from "./ElectrobunDOMAdapter.ts";
import { installWebGPUDiagnostics } from "./diagnostics.ts";

export async function createPixiRenderer(window: GpuWindow): Promise<Application> {
    webgpu.install();
    const created = webgpu.createContext(window);
    const adapter = await webgpu.navigator.requestAdapter({ compatibleSurface: created.context });
    if (!adapter) throw new Error("Electrobun could not provide a WebGPU adapter");
    const device = await adapter.requestDevice();
    installWebGPUDiagnostics(device);
    const queue = device.queue as any;
    const nativeCopyExternalImageToTexture = queue.copyExternalImageToTexture?.bind(queue);
    queue.copyExternalImageToTexture = ({ source }: any, destination: any, copySize: any) => {
        const resource = source?.resource ?? source;
        const context = resource?.getContext?.("2d") ?? source?.getContext?.("2d");
        if (!context?.getImageData) {
            if (!nativeCopyExternalImageToTexture) throw new Error("Canvas source cannot provide RGBA pixels");
            return nativeCopyExternalImageToTexture({ source }, destination, copySize);
        }
        const width = Math.max(1, Number(resource?.width ?? source?.width ?? copySize?.width ?? copySize?.[0] ?? destination?.texture?.width ?? 1) || 1);
        const height = Math.max(1, Number(resource?.height ?? source?.height ?? copySize?.height ?? copySize?.[1] ?? destination?.texture?.height ?? 1) || 1);
        const pixels = context.getImageData(0, 0, width, height).data;
        if ((queue.__externalImageUploadCount ?? 0) < 8) {
            queue.__externalImageUploadCount = (queue.__externalImageUploadCount ?? 0) + 1;
            console.log({ externalImageUpload: true, sourceKeys: Object.keys(source ?? {}), resourceKeys: Object.keys(resource ?? {}), resourceWidth: resource?.width, resourceHeight: resource?.height, width, height, firstPixel: Array.from(pixels.slice(0, 4)), textureFormat: destination?.texture?.format, textureSize: [destination?.texture?.width, destination?.texture?.height] });
        }
        queue.writeTexture(destination, pixels, { bytesPerRow: width * 4, rowsPerImage: height }, { width, height, depthOrArrayLayers: 1 });
    };
    const format = webgpu.navigator.getPreferredCanvasFormat();
    created.context.configure({ device, format, alphaMode: "premultiplied" });

    new ElectrobunDOMAdapter(window).install();
    const encoderPrototype = (GpuEncoderSystem as unknown as { prototype: any }).prototype;
    if (!encoderPrototype.__electrobunStencilGuard) {
        const originalSetStencilReference = encoderPrototype.setStencilReference;
        encoderPrototype.setStencilReference = function (stencilReference: number) {
            const passEncoder = this._passEncoder;
            if (passEncoder && typeof passEncoder.setStencilReference === "function") {
                originalSetStencilReference.call(this, stencilReference);
            }
        };
        encoderPrototype.__electrobunStencilGuard = true;
    }
    const app = new Application();
    await app.init({
        preference: "webgpu",
        canvas: webgpu.utils.createCanvasShim(window),
        width: 1280,
        height: 720,
        background: 0x101522,
        resolution: 1,
        autoStart: true,
        maxTextures: 8,
        gpu: { adapter, device }
    } as never);

    const limits = (app.renderer as any).limits;
    if (limits) {
        limits.maxTextures = 8;
        limits.maxBatchableTextures = 8;
    }

    const rendererType = String((app.renderer as unknown as { type?: unknown }).type ?? "unknown");
    if (rendererType !== "2" && !rendererType.toLowerCase().includes("webgpu")) {
        app.destroy(true);
        throw new Error(`Pixi renderer fallback detected: ${rendererType}`);
    }
    console.log({ pixi: VERSION, renderer: rendererType, format, size: "1280x720", devicePixelRatio: 1 });
    return app;
}
