import {
    BufferImageSource,
    Mesh,
    MeshGeometry,
    Shader,
    Texture,
    compileHighShaderGpuProgram,
    localUniformBit,
    roundPixelsBit,
    type Renderer,
    type TextureSource,
} from "pixi.js";
import { NativeVideo, type NativeVideoFrame } from "./NativeVideo.ts";

type HighShaderBit = Parameters<
    typeof compileHighShaderGpuProgram
>[0]["bits"][number];

interface WebGpuVideoRenderer {
    readonly name: string;
    readonly gpu: { readonly device: GPUDevice };
    readonly texture: {
        getGpuSource(source: TextureSource): GPUTexture;
    };
}

const NV12_TEXTURE_BIT: HighShaderBit = {
    name: "native-video-nv12-textures",
    fragment: {
        header: /* wgsl */ `
            @group(2) @binding(0) var yTexture: texture_2d<f32>;
            @group(2) @binding(1) var uvTexture: texture_2d<f32>;
            @group(2) @binding(2) var videoSampler: sampler;
        `,
        main: /* wgsl */ `
            let rawY = textureSample(yTexture, videoSampler, vUV).r;
            let rawChroma = textureSample(uvTexture, videoSampler, vUV).rg;
            let y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
            let u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
            let v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
            let rgb = clamp(vec3<f32>(
                y + 1.5748 * v,
                y - 0.1873 * u - 0.4681 * v,
                y + 1.8556 * u
            ), vec3<f32>(0.0), vec3<f32>(1.0));
            outColor = vec4<f32>(rgb, 1.0);
        `,
    },
};

const NV12_GPU_PROGRAM = compileHighShaderGpuProgram({
    name: "native-video-nv12",
    bits: [localUniformBit, NV12_TEXTURE_BIT, roundPixelsBit],
});

export class NativeVideoSprite extends Mesh<MeshGeometry, Shader> {
    public readonly video: NativeVideo;

    private readonly ySource: BufferImageSource;
    private readonly uvSource: BufferImageSource;
    private readonly ownedTexture: Texture;
    private readonly ownedGeometry: MeshGeometry;
    private readonly ownedShader: Shader;

    public constructor(video: NativeVideo) {
        const initialY = new Uint8Array(video.width * video.height).fill(16);
        const initialUv = new Uint8Array(
            (video.width * video.height) / 2,
        ).fill(128);
        const ySource = new BufferImageSource({
            resource: initialY,
            width: video.width,
            height: video.height,
            format: "r8unorm",
            alphaMode: "no-premultiply-alpha",
            addressMode: "clamp-to-edge",
            scaleMode: "linear",
            autoGenerateMipmaps: false,
            autoGarbageCollect: false,
            label: "NativeVideo Y plane",
        });
        const uvSource = new BufferImageSource({
            resource: initialUv,
            width: video.width / 2,
            height: video.height / 2,
            format: "rg8unorm",
            alphaMode: "no-premultiply-alpha",
            addressMode: "clamp-to-edge",
            scaleMode: "linear",
            autoGenerateMipmaps: false,
            autoGarbageCollect: false,
            label: "NativeVideo UV plane",
        });
        const texture = new Texture({
            source: ySource,
            label: "NativeVideo mesh texture",
        });
        const geometry = new MeshGeometry({
            positions: new Float32Array([
                0,
                0,
                video.width,
                0,
                video.width,
                video.height,
                0,
                video.height,
            ]),
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        });
        const shader = new Shader({
            gpuProgram: NV12_GPU_PROGRAM,
            resources: {
                yTexture: ySource,
                uvTexture: uvSource,
                videoSampler: ySource.style,
            },
        });

        super({ geometry, shader, texture });
        this.video = video;
        this.ySource = ySource;
        this.uvSource = uvSource;
        this.ownedTexture = texture;
        this.ownedGeometry = geometry;
        this.ownedShader = shader;
        this.onRender = (renderer) => this.uploadLatestFrame(renderer);
    }

    public override destroy(): void {
        if (this.destroyed) return;
        this.onRender = null;
        super.destroy();
        this.ownedShader.destroy(false);
        this.ownedGeometry.destroy(true);
        this.ownedTexture.destroy(true);
        this.uvSource.destroy();
    }

    private uploadLatestFrame(renderer: Renderer): void {
        const frame = this.video.takeLatestFrame();
        if (!frame) return;

        const webGpuRenderer = renderer as unknown as WebGpuVideoRenderer;
        if (webGpuRenderer.name !== "webgpu") {
            throw new Error("NativeVideoSprite requires the WebGPU renderer");
        }

        uploadNv12Frame(
            webGpuRenderer,
            this.ySource,
            this.uvSource,
            frame,
        );
        this.video.markFramePresented();
    }
}

export function uploadNv12Frame(
    renderer: WebGpuVideoRenderer,
    ySource: TextureSource,
    uvSource: TextureSource,
    frame: NativeVideoFrame,
): void {
    const device = renderer.gpu.device;
    const yTexture = renderer.texture.getGpuSource(ySource);
    const uvTexture = renderer.texture.getGpuSource(uvSource);

    device.queue.writeTexture(
        { texture: yTexture },
        frame.y as unknown as GPUAllowSharedBufferSource,
        { bytesPerRow: frame.yStride, rowsPerImage: frame.height },
        { width: frame.width, height: frame.height, depthOrArrayLayers: 1 },
    );
    device.queue.writeTexture(
        { texture: uvTexture },
        frame.uv as unknown as GPUAllowSharedBufferSource,
        { bytesPerRow: frame.uvStride, rowsPerImage: frame.height / 2 },
        {
            width: frame.width / 2,
            height: frame.height / 2,
            depthOrArrayLayers: 1,
        },
    );
}
