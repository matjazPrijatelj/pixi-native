import {
    BufferImageSource,
    Mesh,
    MeshGeometry,
    Shader,
    Texture,
    compileHighShaderGpuProgram,
    compileHighShaderGlProgram,
    localUniformBit,
    localUniformBitGl,
    roundPixelsBit,
    roundPixelsBitGl,
    type Renderer,
    type TextureSource,
} from "pixi.js";
import { NativeVideo, type NativeVideoFrame } from "./NativeVideo.ts";
import {
    getPackedAlphaVideoLayout,
    type PackedAlphaVideoLayout,
    type VideoSpriteOptions,
} from "./packedAlpha.ts";

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

interface WebGlVideoRenderer {
    readonly name: string;
    readonly gl: {
        readonly TEXTURE0: number;
        readonly TEXTURE_2D: number;
        readonly RED: number;
        readonly RG: number;
        readonly UNSIGNED_BYTE: number;
        activeTexture(texture: number): void;
        bindTexture(target: number, texture: unknown): void;
        pixelStorei(parameter: number, value: number): void;
        texSubImage2D(...args: unknown[]): void;
        readonly UNPACK_ALIGNMENT: number;
    };
    readonly texture: {
        bindSource(source: TextureSource, location?: number): void;
        getGlSource(source: TextureSource): {
            texture: unknown;
            target: number;
        };
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

function createPackedAlphaGpuProgram(
    layout: PackedAlphaVideoLayout,
): ReturnType<typeof compileHighShaderGpuProgram> {
    const textureBit: HighShaderBit = {
        name: "native-video-packed-alpha-textures",
        fragment: {
            header: /* wgsl */ `
                @group(2) @binding(0) var yTexture: texture_2d<f32>;
                @group(2) @binding(1) var uvTexture: texture_2d<f32>;
                @group(2) @binding(2) var videoSampler: sampler;
            `,
            main: /* wgsl */ `
                let colorFraction = ${layout.colorFraction};
                let yTexel = vec2<f32>(${layout.yTexelX}, ${layout.yTexelY});
                let uvTexel = vec2<f32>(${layout.uvTexelX}, ${layout.uvTexelY});
                let sourceUV = clamp(vUV, vec2<f32>(0.0), vec2<f32>(1.0));
                let colorYUV = vec2<f32>(
                    clamp(sourceUV.x * colorFraction, yTexel.x * 0.5, colorFraction - yTexel.x * 0.5),
                    clamp(sourceUV.y, yTexel.y * 0.5, 1.0 - yTexel.y * 0.5)
                );
                let colorUvUV = vec2<f32>(
                    clamp(sourceUV.x * colorFraction, uvTexel.x * 0.5, colorFraction - uvTexel.x * 0.5),
                    clamp(sourceUV.y, uvTexel.y * 0.5, 1.0 - uvTexel.y * 0.5)
                );
                let alphaUV = vec2<f32>(
                    clamp(colorFraction + sourceUV.x * (1.0 - colorFraction), colorFraction + yTexel.x * 0.5, 1.0 - yTexel.x * 0.5),
                    colorYUV.y
                );
                let rawY = textureSample(yTexture, videoSampler, colorYUV).r;
                let rawChroma = textureSample(uvTexture, videoSampler, colorUvUV).rg;
                let y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
                let u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
                let v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
                let rgb = clamp(vec3<f32>(
                    y + 1.5748 * v,
                    y - 0.1873 * u - 0.4681 * v,
                    y + 1.8556 * u
                ), vec3<f32>(0.0), vec3<f32>(1.0));
                let alpha = clamp(
                    (textureSample(yTexture, videoSampler, alphaUV).r - (16.0 / 255.0)) * (255.0 / 219.0),
                    0.0,
                    1.0
                );
                outColor = vec4<f32>(rgb * alpha, alpha);
            `,
        },
    };
    return compileHighShaderGpuProgram({
        name: `native-video-packed-alpha-${layout.colorWidth}-${layout.alphaWidth}`,
        bits: [localUniformBit, textureBit, roundPixelsBit],
    });
}

const NV12_GL_TEXTURE_BIT: HighShaderBit = {
    name: "native-video-nv12-textures-gl",
    fragment: {
        header: /* glsl */ `
            uniform sampler2D yTexture;
            uniform sampler2D uvTexture;
        `,
        main: /* glsl */ `
            float rawY = texture(yTexture, vUV).r;
            vec2 rawChroma = texture(uvTexture, vUV).rg;
            float y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
            float u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
            float v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
            vec3 rgb = clamp(vec3(
                y + 1.5748 * v,
                y - 0.1873 * u - 0.4681 * v,
                y + 1.8556 * u
            ), vec3(0.0), vec3(1.0));
            outColor = vec4(rgb, 1.0);
        `,
    },
};

function createNv12GlProgram(): ReturnType<typeof compileHighShaderGlProgram> {
    return compileHighShaderGlProgram({
        name: "native-video-nv12-gl",
        bits: [localUniformBitGl, NV12_GL_TEXTURE_BIT, roundPixelsBitGl],
    });
}

function createPackedAlphaGlProgram(
    layout: PackedAlphaVideoLayout,
): ReturnType<typeof compileHighShaderGlProgram> {
    const textureBit: HighShaderBit = {
        name: "native-video-packed-alpha-textures-gl",
        fragment: {
            header: /* glsl */ `
                uniform sampler2D yTexture;
                uniform sampler2D uvTexture;
            `,
            main: /* glsl */ `
                float colorFraction = ${layout.colorFraction};
                vec2 yTexel = vec2(${layout.yTexelX}, ${layout.yTexelY});
                vec2 uvTexel = vec2(${layout.uvTexelX}, ${layout.uvTexelY});
                vec2 sourceUV = clamp(vUV, vec2(0.0), vec2(1.0));
                vec2 colorYUV = vec2(
                    clamp(sourceUV.x * colorFraction, yTexel.x * 0.5, colorFraction - yTexel.x * 0.5),
                    clamp(sourceUV.y, yTexel.y * 0.5, 1.0 - yTexel.y * 0.5)
                );
                vec2 colorUvUV = vec2(
                    clamp(sourceUV.x * colorFraction, uvTexel.x * 0.5, colorFraction - uvTexel.x * 0.5),
                    clamp(sourceUV.y, uvTexel.y * 0.5, 1.0 - uvTexel.y * 0.5)
                );
                vec2 alphaUV = vec2(
                    clamp(colorFraction + sourceUV.x * (1.0 - colorFraction), colorFraction + yTexel.x * 0.5, 1.0 - yTexel.x * 0.5),
                    colorYUV.y
                );
                float rawY = texture(yTexture, colorYUV).r;
                vec2 rawChroma = texture(uvTexture, colorUvUV).rg;
                float y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
                float u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
                float v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
                vec3 rgb = clamp(vec3(
                    y + 1.5748 * v,
                    y - 0.1873 * u - 0.4681 * v,
                    y + 1.8556 * u
                ), vec3(0.0), vec3(1.0));
                float alpha = clamp(
                    (texture(yTexture, alphaUV).r - (16.0 / 255.0)) * (255.0 / 219.0),
                    0.0,
                    1.0
                );
                outColor = vec4(rgb * alpha, alpha);
            `,
        },
    };
    return compileHighShaderGlProgram({
        name: `native-video-packed-alpha-gl-${layout.colorWidth}-${layout.alphaWidth}`,
        bits: [localUniformBitGl, textureBit, roundPixelsBitGl],
    });
}

export class NativeVideoSprite extends Mesh<MeshGeometry, Shader> {
    public readonly video: NativeVideo;

    private readonly ySource: BufferImageSource;
    private readonly uvSource: BufferImageSource;
    private readonly ownedTexture: Texture;
    private readonly ownedGeometry: MeshGeometry;
    private readonly ownedShader: Shader;
    private readonly emptyFrame: NativeVideoFrame;
    private needsClear = false;
    private readonly handleVideoEmptied = (): void => {
        this.needsClear = true;
    };

    public constructor(video: NativeVideo, options: VideoSpriteOptions = {}) {
        const packedAlphaLayout =
            options.alphaMaskScale === undefined
                ? undefined
                : getPackedAlphaVideoLayout(
                      video.width,
                      video.height,
                      options.alphaMaskScale,
                  );
        const initialY = new Uint8Array(video.width * video.height).fill(16);
        const initialUv = new Uint8Array((video.width * video.height) / 2).fill(
            128,
        );
        const ySource = new BufferImageSource({
            resource: initialY,
            width: video.width,
            height: video.height,
            format: "r8unorm",
            alphaMode: packedAlphaLayout
                ? "premultiply-alpha-on-upload"
                : "no-premultiply-alpha",
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
                packedAlphaLayout?.colorWidth ?? video.width,
                0,
                packedAlphaLayout?.colorWidth ?? video.width,
                video.height,
                0,
                video.height,
            ]),
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        });
        const shader = new Shader({
            glProgram: globalThis.document
                ? packedAlphaLayout
                    ? createPackedAlphaGlProgram(packedAlphaLayout)
                    : createNv12GlProgram()
                : undefined,
            gpuProgram: packedAlphaLayout
                ? createPackedAlphaGpuProgram(packedAlphaLayout)
                : NV12_GPU_PROGRAM,
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
        this.emptyFrame = {
            width: video.width,
            height: video.height,
            timestampUs: 0,
            y: initialY,
            uv: initialUv,
            yStride: video.width,
            uvStride: video.width,
            pixelFormat: "nv12",
        };
        video.addEventListener("emptied", this.handleVideoEmptied);
        this.onRender = (renderer) => this.uploadLatestFrame(renderer);
    }

    public override destroy(): void {
        if (this.destroyed) return;
        this.video.removeEventListener("emptied", this.handleVideoEmptied);
        this.onRender = null;
        super.destroy();
        this.ownedShader.destroy(false);
        this.ownedGeometry.destroy(true);
        this.ownedTexture.destroy(true);
        this.uvSource.destroy();
    }

    private uploadLatestFrame(renderer: Renderer): void {
        const isClear = this.needsClear;
        const frame = isClear ? this.emptyFrame : this.video.takeLatestFrame();
        if (!frame) return;

        if (renderer.name === "webgpu") {
            const webGpuRenderer = renderer as unknown as WebGpuVideoRenderer;
            uploadNv12FrameWebGpu(
                webGpuRenderer,
                this.ySource,
                this.uvSource,
                frame,
            );
        } else if (renderer.name === "webgl") {
            uploadNv12FrameWebGl(
                renderer as unknown as WebGlVideoRenderer,
                this.ySource,
                this.uvSource,
                frame,
            );
        } else {
            throw new Error("NativeVideoSprite requires WebGPU or WebGL");
        }
        if (isClear) this.needsClear = false;
        else this.video.markFramePresented();
    }
}

export function uploadNv12FrameWebGpu(
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

export function uploadNv12FrameWebGl(
    renderer: WebGlVideoRenderer,
    ySource: TextureSource,
    uvSource: TextureSource,
    frame: NativeVideoFrame,
): void {
    const yTexture = renderer.texture.getGlSource(ySource);
    const uvTexture = renderer.texture.getGlSource(uvSource);
    const gl = renderer.gl;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    try {
        renderer.texture.bindSource(ySource, 0);
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            frame.width,
            frame.height,
            gl.RED,
            gl.UNSIGNED_BYTE,
            frame.y,
        );
        renderer.texture.bindSource(uvSource, 1);
        gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            0,
            0,
            frame.width / 2,
            frame.height / 2,
            gl.RG,
            gl.UNSIGNED_BYTE,
            frame.uv,
        );
    } finally {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.activeTexture(gl.TEXTURE0);
    }
}
