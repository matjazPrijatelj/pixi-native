import { createCanvas, type Canvas } from "@napi-rs/canvas";

/** Canvas-like object backed by a native Skia Canvas2D surface. */
export class NodeCanvas {
    public readonly style: Record<string, string> = {};
    private readonly canvas: Canvas;

    public constructor(width = 1, height = 1) {
        this.canvas = createCanvas(width, height);
    }

    public get width(): number {
        return this.canvas.width;
    }

    public set width(value: number) {
        this.canvas.width = Math.max(1, Math.floor(value));
    }

    public get height(): number {
        return this.canvas.height;
    }

    public set height(value: number) {
        this.canvas.height = Math.max(1, Math.floor(value));
    }

    public getContext(type: string): unknown {
        if (type === "2d") return this.canvas.getContext("2d");
        if (type === "webgl" || type === "webgl2") {
            return {
                MAX_TEXTURE_IMAGE_UNITS: 16,
                FRAGMENT_SHADER: 35632,
                HIGH_FLOAT: 36338,
                getParameter: (name: number) => (name === 16 ? 16 : 16),
                getShaderPrecisionFormat: () => ({ precision: 1 }),
                getContextAttributes: () => ({ stencil: true }),
                getExtension: () => ({ loseContext() {} }),
            };
        }
        return null;
    }

    /** Returns Skia's native premultiplied pixels in RGBA byte order. */
    public getPremultipliedRgbaPixels(): Uint8Array {
        const pixels = this.canvas.data();
        return new Uint8Array(
            pixels.buffer,
            pixels.byteOffset,
            pixels.byteLength,
        );
    }
}
