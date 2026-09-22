import {
  BufferImageSource,
  ExternalSource,
  Mesh,
  MeshGeometry,
  Shader,
  Texture,
  TextureView,
  compileHighShaderGpuProgram,
  compileHighShaderGlProgram,
  localUniformBit,
  localUniformBitGl,
  roundPixelsBit,
  roundPixelsBitGl,
  type Renderer,
  type TextureSource,
} from "pixi.js";
import {
  NativeVideo,
  isGpuNativeVideoFrame,
  type GpuNativeVideoFrame,
  type NativeVideoFrame,
} from "@pixi-native/core";
import {
  acquireNativeVideoGpuTexture,
  retireNativeVideoGpuTexture,
} from "@pixi-native/core/video/gpuInterop.js";
import {
  getPackedAlphaVideoLayout,
  type PackedAlphaVideoLayout,
  type VideoSpriteOptions,
} from "@pixi-native/core/video/packedAlpha.js";

type HighShaderBit = Parameters<
  typeof compileHighShaderGpuProgram
>[0]["bits"][number];
type GlVideoProgram = ReturnType<typeof compileHighShaderGlProgram>;

interface WebGpuVideoRenderer {
  readonly name: string;
  readonly uid: number;
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

// Pixi keys TextureView objects by this exact descriptor serialization. Dawn's
// JS converter does not expose multi-planar aspects, so native code creates the
// views and these keys let Pixi reuse them without calling createView itself.
const NV12_Y_VIEW_CACHE_KEY = "r8unorm..plane0-only.0..0.";
const NV12_UV_VIEW_CACHE_KEY = "rg8unorm..plane1-only.0..0.";

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

let nv12GlProgram: GlVideoProgram | undefined;
const packedAlphaGlPrograms = new Map<string, GlVideoProgram>();

function getNv12GlProgram(): GlVideoProgram {
  nv12GlProgram ??= compileHighShaderGlProgram({
    name: "native-video-nv12-gl",
    bits: [localUniformBitGl, NV12_GL_TEXTURE_BIT, roundPixelsBitGl],
  });
  return nv12GlProgram;
}

function getPackedAlphaGlProgram(
  layout: PackedAlphaVideoLayout,
): GlVideoProgram {
  const cacheKey = `${layout.frameWidth}:${layout.frameHeight}:${layout.colorWidth}`;
  const cachedProgram = packedAlphaGlPrograms.get(cacheKey);
  if (cachedProgram) return cachedProgram;

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
  const program = compileHighShaderGlProgram({
    name: `native-video-packed-alpha-gl-${layout.colorWidth}-${layout.alphaWidth}`,
    bits: [localUniformBitGl, textureBit, roundPixelsBitGl],
  });
  packedAlphaGlPrograms.set(cacheKey, program);
  return program;
}

/** PixiJS 8 mesh that uploads and presents frames from a {@link NativeVideo}. */
export class NativeVideoSprite extends Mesh<MeshGeometry, Shader> {
  public readonly video: NativeVideo;

  private readonly ySource: BufferImageSource;
  private readonly uvSource: BufferImageSource;
  private readonly ownedTexture: Texture;
  private readonly ownedGeometry: MeshGeometry;
  private readonly ownedShader: Shader;
  private readonly emptyFrame: NativeVideoFrame;
  private gpuSource: ExternalSource | undefined;
  private gpuYView: TextureView | undefined;
  private gpuUvView: TextureView | undefined;
  private gpuDevice: GPUDevice | undefined;
  private readonly gpuViewsBySurface = new Map<
    string,
    { readonly y: TextureView; readonly uv: TextureView }
  >();
  private gpuFrameAwaitingRelease: GpuNativeVideoFrame | undefined;
  private needsClear = false;
  private presentationSuspended = false;
  private readonly handleVideoEmptied = (): void => {
    this.needsClear = true;
  };

  /** Creates a sprite that borrows the video; destroying it does not destroy the video. */
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
          ? getPackedAlphaGlProgram(packedAlphaLayout)
          : getNv12GlProgram()
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

  /** Releases sprite-owned GPU resources and detaches from the video. */
  public override destroy(): void {
    if (this.destroyed) return;
    this.video.removeEventListener("emptied", this.handleVideoEmptied);
    this.setPresentationSuspended(true);
    for (const views of this.gpuViewsBySurface.values()) {
      views.y.destroy();
      views.uv.destroy();
    }
    this.gpuViewsBySurface.clear();
    this.gpuSource?.destroy();
    this.onRender = null;
    super.destroy();
    this.ownedShader.destroy(false);
    // Pixi Geometry.destroy() removes its listeners before it emits `unload`.
    // Unload first so the active renderer can delete the geometry's VAO.
    this.ownedGeometry.unload();
    this.ownedGeometry.destroy(true);
    this.ownedTexture.destroy(true);
    this.uvSource.destroy();
  }

  /** Stops frame upload while retaining a live decoder connection. */
  public setPresentationSuspended(suspended: boolean): void {
    if (this.presentationSuspended === suspended) return;
    this.presentationSuspended = suspended;
    if (!suspended) return;
    if (this.gpuFrameAwaitingRelease) {
      this.retireGpuFrame(this.gpuFrameAwaitingRelease);
      this.gpuFrameAwaitingRelease = undefined;
    }
    // Replace the imported texture in the shader before the next submission.
    // The stream container can then fade out without binding shared NV12 memory.
    this.restoreCpuResources();
  }

  private uploadLatestFrame(renderer: Renderer): void {
    if (this.presentationSuspended) return;
    const isClear = this.needsClear;
    const frame = isClear ? this.emptyFrame : this.video.takeLatestFrame();
    if (!frame) return;
    const previousGpuFrame = this.gpuFrameAwaitingRelease;

    if (renderer.name === "webgpu") {
      const webGpuRenderer = renderer as unknown as WebGpuVideoRenderer;
      if (isGpuNativeVideoFrame(frame)) {
        try {
          this.presentGpuFrame(webGpuRenderer, renderer, frame);
        } catch (error) {
          const rendererOwnedFrames: GpuNativeVideoFrame[] = [];
          if (previousGpuFrame) {
            if (this.retireGpuFrame(previousGpuFrame)) {
              rendererOwnedFrames.push(previousGpuFrame);
            }
            this.gpuFrameAwaitingRelease = undefined;
          }
          if (this.retireGpuFrame(frame)) rendererOwnedFrames.push(frame);
          this.restoreCpuResources();
          this.video.fallbackFromGpuFrame(frame, error, rendererOwnedFrames);
          return;
        }
      } else {
        if (previousGpuFrame) this.retireGpuFrame(previousGpuFrame);
        this.restoreCpuResources();
        uploadNv12FrameWebGpu(
          webGpuRenderer,
          this.ySource,
          this.uvSource,
          frame,
        );
        this.gpuFrameAwaitingRelease = undefined;
      }
    } else if (renderer.name === "webgl") {
      if (isGpuNativeVideoFrame(frame)) {
        this.video.releaseFrame(frame);
        throw new Error("Shared NV12 frames require the WebGPU renderer");
      }
      this.restoreCpuResources();
      uploadNv12FrameWebGl(
        renderer as unknown as WebGlVideoRenderer,
        this.ySource,
        this.uvSource,
        frame,
      );
      this.gpuFrameAwaitingRelease = undefined;
    } else {
      throw new Error("NativeVideoSprite requires WebGPU or WebGL");
    }
    // Imported NV12 surfaces remain renderer-owned until all submitted work
    // has completed and the native renderer can safely end their access scope.
    if (isClear) this.needsClear = false;
    else this.video.markFramePresented();
  }

  private retireGpuFrame(frame: GpuNativeVideoFrame): boolean {
    if (!this.gpuDevice) return false;
    return retireNativeVideoGpuTexture(this.gpuDevice, frame);
  }

  private presentGpuFrame(
    renderer: WebGpuVideoRenderer,
    pixiRenderer: Renderer,
    frame: GpuNativeVideoFrame,
  ): void {
    this.gpuDevice = renderer.gpu.device;
    const imported = acquireNativeVideoGpuTexture(renderer.gpu.device, frame);
    if (!this.gpuSource) {
      this.gpuSource = new ExternalSource({
        resource: imported.texture,
        renderer: pixiRenderer,
        width: frame.width,
        height: frame.height,
        label: "NativeVideo shared NV12 surface",
      });
    } else {
      this.gpuSource.updateGPUTexture(
        imported.texture,
        frame.width,
        frame.height,
      );
    }
    const surfaceKey = `${frame.sessionId}:${frame.surfaceId}`;
    let views = this.gpuViewsBySurface.get(surfaceKey);
    if (!views) {
      views = {
        y: new TextureView(this.gpuSource, {
          format: "r8unorm",
          aspect: "plane0-only" as GPUTextureAspect,
        }),
        uv: new TextureView(this.gpuSource, {
          format: "rg8unorm",
          aspect: "plane1-only" as GPUTextureAspect,
        }),
      };
      this.gpuViewsBySurface.set(surfaceKey, views);
    }
    // TextureView keeps one resource id even when ExternalSource changes.
    // A distinct pair per decoder surface gives Pixi's bind-group cache a
    // stable key for each imported texture instead of reusing frame zero.
    this.gpuYView = views.y;
    this.gpuUvView = views.uv;
    const gpuData = (
      this.gpuSource as unknown as {
        _gpuData: Record<
          number,
          { textureViews: Record<string, GPUTextureView> }
        >;
      }
    )._gpuData[renderer.uid];
    gpuData.textureViews[NV12_Y_VIEW_CACHE_KEY] = imported.yView;
    gpuData.textureViews[NV12_UV_VIEW_CACHE_KEY] = imported.uvView;
    this.ownedShader.resources.yTexture = this.gpuYView!;
    this.ownedShader.resources.uvTexture = this.gpuUvView!;
    this.gpuFrameAwaitingRelease = frame;
  }

  private restoreCpuResources(): void {
    if (this.ownedShader.resources.yTexture === this.ySource) return;
    this.ownedShader.resources.yTexture = this.ySource;
    this.ownedShader.resources.uvTexture = this.uvSource;
  }
}

export function uploadNv12FrameWebGpu(
  renderer: WebGpuVideoRenderer,
  ySource: TextureSource,
  uvSource: TextureSource,
  frame: NativeVideoFrame,
): void {
  if (isGpuNativeVideoFrame(frame)) {
    throw new Error("Shared NV12 frames must be imported, not uploaded");
  }
  const device = renderer.gpu.device;
  const yTexture = renderer.texture.getGpuSource(ySource);
  const uvTexture = renderer.texture.getGpuSource(uvSource);

  device.queue.writeTexture(
    { texture: yTexture },
    frame.y as unknown as AllowSharedBufferSource,
    { bytesPerRow: frame.yStride, rowsPerImage: frame.height },
    { width: frame.width, height: frame.height, depthOrArrayLayers: 1 },
  );
  device.queue.writeTexture(
    { texture: uvTexture },
    frame.uv as unknown as AllowSharedBufferSource,
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
  if (isGpuNativeVideoFrame(frame)) {
    throw new Error("Shared NV12 frames are not supported by WebGL");
  }
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
