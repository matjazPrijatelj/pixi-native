import {
    BaseTexture,
    FORMATS,
    Geometry,
    Mesh,
    type Renderer,
    Shader,
    Texture,
    TYPES,
} from "pixi.js-v7";
import { NativeVideo } from "./NativeVideo.ts";

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
    private destroyedVideo = false;
    private needsClear = false;
    private readonly handleVideoEmptied = (): void => {
        this.needsClear = true;
    };

    public constructor(video: NativeVideo) {
        const yData = new Uint8Array(video.width * video.height).fill(16);
        const uvData = new Uint8Array((video.width * video.height) / 2).fill(128);
        const yBaseTexture = BaseTexture.fromBuffer(yData, video.width, video.height, {
            format: FORMATS.RED,
            type: TYPES.UNSIGNED_BYTE,
        });
        const uvBaseTexture = BaseTexture.fromBuffer(uvData, video.width / 2, video.height / 2, {
            format: FORMATS.RG,
            type: TYPES.UNSIGNED_BYTE,
        });
        const yTexture = new Texture(yBaseTexture);
        const uvTexture = new Texture(uvBaseTexture);
        const geometry = new Geometry()
            .addAttribute("aVertexPosition", [0, 0, video.width, 0, video.width, video.height, 0, video.height], 2)
            .addAttribute("aTextureCoord", [0, 0, 1, 0, 1, 1, 0, 1], 2)
            .addIndex([0, 1, 2, 0, 2, 3]);
        const shader = Shader.from(VERTEX_SHADER, FRAGMENT_SHADER, {
            yTexture,
            uvTexture,
        });

        super(geometry, shader);
        this.video = video;
        this.yPlane = { data: yData, baseTexture: yBaseTexture };
        this.uvPlane = { data: uvData, baseTexture: uvBaseTexture };
        this.yTexture = yTexture;
        this.uvTexture = uvTexture;
        video.addEventListener("emptied", this.handleVideoEmptied);
    }

    public override render(renderer: Renderer): void {
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
        copyPlane(this.yPlane.data, frame.y, frame.yStride, frame.width, frame.height);
        copyPlane(this.uvPlane.data, frame.uv, frame.uvStride, frame.width, frame.height / 2);
        this.yPlane.baseTexture.update();
        this.uvPlane.baseTexture.update();
        this.video.markFramePresented();
        return true;
    }

    public override destroy(options?: boolean | { children?: boolean; texture?: boolean; baseTexture?: boolean }): void {
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
        target.set(source.subarray(row * sourceStride, row * sourceStride + width), row * width);
    }
}
