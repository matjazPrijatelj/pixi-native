import { createCanvas } from "@napi-rs/canvas";
/** Canvas-like object backed by a native Skia Canvas2D surface. */
export class NodeCanvas {
    style = {};
    canvas;
    constructor(width = 1, height = 1) {
        this.canvas = createCanvas(width, height);
    }
    get width() {
        return this.canvas.width;
    }
    set width(value) {
        this.canvas.width = Math.max(1, Math.floor(value));
    }
    get height() {
        return this.canvas.height;
    }
    set height(value) {
        this.canvas.height = Math.max(1, Math.floor(value));
    }
    getContext(type) {
        if (type === "2d")
            return this.canvas.getContext("2d");
        if (type === "webgl" || type === "webgl2") {
            return {
                MAX_TEXTURE_IMAGE_UNITS: 16,
                FRAGMENT_SHADER: 35632,
                HIGH_FLOAT: 36338,
                getParameter: (name) => (name === 16 ? 16 : 16),
                getShaderPrecisionFormat: () => ({ precision: 1 }),
                getContextAttributes: () => ({ stencil: true }),
                getExtension: () => ({ loseContext() { } }),
            };
        }
        return null;
    }
    /** Returns Skia's native premultiplied pixels in RGBA byte order. */
    getPremultipliedRgbaPixels() {
        const pixels = this.canvas.data();
        return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    }
}
