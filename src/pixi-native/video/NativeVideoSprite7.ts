import {
    BaseTexture,
    BLEND_MODES,
    FORMATS,
    Geometry,
    Mesh,
    type Renderer,
    Shader,
    Texture,
    TYPES,
} from "pixi.js-v7";
import { NativeVideo } from "./NativeVideo.ts";
import {
    getPackedAlphaVideoLayout,
    type PackedAlphaVideoLayout,
    type VideoSpriteOptions,
} from "./packedAlpha.ts";

const VERTEX_SHADER = `
    attribute vec2 aVertexPosition;
    attribute vec2 aTextureCoord;
    uniform mat3 translationMatrix;
    uniform mat3 projectionMatrix;
    varying vec2 vTextureCoord;

    void main(void) {
        vTextureCoord = aTextureCoord;
        gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    }
`;

const FRAGMENT_SHADER = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D yTexture;
    uniform sampler2D uvTexture;

    void main(void) {
        float rawY = texture2D(yTexture, vTextureCoord).r;
        vec2 rawChroma = texture2D(uvTexture, vTextureCoord).rg;
        float y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
        float u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
        float v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
        vec3 rgb = clamp(vec3(
            y + 1.5748 * v,
            y - 0.1873 * u - 0.4681 * v,
            y + 1.8556 * u
        ), vec3(0.0), vec3(1.0));
        gl_FragColor = vec4(rgb, 1.0);
    }
`;

function createPackedAlphaFragmentShader(
    layout: PackedAlphaVideoLayout,
): string {
    return `
        precision highp float;
        varying vec2 vTextureCoord;
        uniform sampler2D yTexture;
        uniform sampler2D uvTexture;
        uniform float uAlpha;

        void main(void) {
            float colorFraction = ${layout.colorFraction};
            vec2 yTexel = vec2(${layout.yTexelX}, ${layout.yTexelY});
            vec2 uvTexel = vec2(${layout.uvTexelX}, ${layout.uvTexelY});
            vec2 sourceUV = clamp(vTextureCoord, vec2(0.0), vec2(1.0));
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
            float rawY = texture2D(yTexture, colorYUV).r;
            vec2 rawChroma = texture2D(uvTexture, colorUvUV).rg;
            float y = (rawY - (16.0 / 255.0)) * (255.0 / 219.0);
            float u = (rawChroma.r - (128.0 / 255.0)) * (255.0 / 224.0);
            float v = (rawChroma.g - (128.0 / 255.0)) * (255.0 / 224.0);
            vec3 rgb = clamp(vec3(
                y + 1.5748 * v,
                y - 0.1873 * u - 0.4681 * v,
                y + 1.8556 * u
            ), vec3(0.0), vec3(1.0));
            float alpha = clamp(
                (texture2D(yTexture, alphaUV).r - (16.0 / 255.0)) * (255.0 / 219.0),
                0.0,
                1.0
            ) * uAlpha;
            gl_FragColor = vec4(rgb * alpha, alpha);
        }
    `;
}

interface MutablePlane {
    readonly data: Uint8Array;
    readonly baseTexture: BaseTexture;
}

/** Pixi 7 WebGL NV12 mesh; color conversion happens in the fragment shader. */
export class NativeVideoSprite7 extends Mesh<Shader> {
    public readonly video: NativeVideo;
    private readonly yPlane: MutablePlane;
    private readonly uvPlane: MutablePlane;
    private readonly yTexture: Texture;
    private readonly uvTexture: Texture;
    private readonly usesPackedAlpha: boolean;
    private destroyedVideo = false;
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
        const yData = new Uint8Array(video.width * video.height).fill(16);
        const uvData = new Uint8Array((video.width * video.height) / 2).fill(
            128,
        );
        const yBaseTexture = BaseTexture.fromBuffer(
            yData,
            video.width,
            video.height,
            {
                format: FORMATS.RED,
                type: TYPES.UNSIGNED_BYTE,
            },
        );
        const uvBaseTexture = BaseTexture.fromBuffer(
            uvData,
            video.width / 2,
            video.height / 2,
            {
                format: FORMATS.RG,
                type: TYPES.UNSIGNED_BYTE,
            },
        );
        const yTexture = new Texture(yBaseTexture);
        const uvTexture = new Texture(uvBaseTexture);
        const geometry = new Geometry()
            .addAttribute(
                "aVertexPosition",
                [
                    0,
                    0,
                    packedAlphaLayout?.colorWidth ?? video.width,
                    0,
                    packedAlphaLayout?.colorWidth ?? video.width,
                    video.height,
                    0,
                    video.height,
                ],
                2,
            )
            .addAttribute("aTextureCoord", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const shader = Shader.from(
            VERTEX_SHADER,
            packedAlphaLayout
                ? createPackedAlphaFragmentShader(packedAlphaLayout)
                : FRAGMENT_SHADER,
            {
                yTexture,
                uvTexture,
                uAlpha: 1,
            },
        );

        super(geometry, shader);
        this.video = video;
        this.yPlane = { data: yData, baseTexture: yBaseTexture };
        this.uvPlane = { data: uvData, baseTexture: uvBaseTexture };
        this.yTexture = yTexture;
        this.uvTexture = uvTexture;
        this.usesPackedAlpha = packedAlphaLayout !== undefined;
        if (this.usesPackedAlpha) this.blendMode = BLEND_MODES.NORMAL;
        video.addEventListener("emptied", this.handleVideoEmptied);
    }

    public override render(renderer: Renderer): void {
        if (this.usesPackedAlpha) this.shader.uniforms.uAlpha = this.worldAlpha;
        this.updateFrame();
        super.render(renderer);
    }

    public updateFrame(): boolean {
        if (this.needsClear) {
            this.needsClear = false;
            this.yPlane.data.fill(16);
            this.uvPlane.data.fill(128);
            this.yPlane.baseTexture.update();
            this.uvPlane.baseTexture.update();
            return true;
        }
        const frame = this.video.takeLatestFrame();
        if (!frame) return false;
        copyPlane(
            this.yPlane.data,
            frame.y,
            frame.yStride,
            frame.width,
            frame.height,
        );
        copyPlane(
            this.uvPlane.data,
            frame.uv,
            frame.uvStride,
            frame.width,
            frame.height / 2,
        );
        this.yPlane.baseTexture.update();
        this.uvPlane.baseTexture.update();
        this.video.markFramePresented();
        return true;
    }

    public override destroy(
        options?:
            | boolean
            | { children?: boolean; texture?: boolean; baseTexture?: boolean },
    ): void {
        if (this.destroyedVideo) return;
        this.destroyedVideo = true;
        this.video.removeEventListener("emptied", this.handleVideoEmptied);
        this.yTexture.destroy(true);
        this.uvTexture.destroy(true);
        this.video.destroy();
        super.destroy(options as never);
    }
}

/** Copies a possibly-strided native plane into the tightly packed Pixi buffer. */
function copyPlane(
    target: Uint8Array,
    source: Uint8Array,
    sourceStride: number,
    width: number,
    height: number,
): void {
    if (sourceStride === width) {
        target.set(source.subarray(0, width * height));
        return;
    }
    for (let row = 0; row < height; row++) {
        target.set(
            source.subarray(row * sourceStride, row * sourceStride + width),
            row * width,
        );
    }
}
