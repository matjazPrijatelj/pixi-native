import { Canvas } from "skia-canvas";

/** Canvas-like object backed by a native Skia surface for Pixi Text. */
export class NodeTextCanvas {
    public readonly style: Record<string, string> = {};
    private readonly skia: Canvas;

    public constructor(width = 1, height = 1) { this.skia = new Canvas(width, height); }
    public get width(): number { return this.skia.width; }
    public set width(value: number) { this.skia.width = Math.max(1, Math.floor(value)); }
    public get height(): number { return this.skia.height; }
    public set height(value: number) { this.skia.height = Math.max(1, Math.floor(value)); }
    public getContext(type: string): unknown {
        if (type === "2d") return this.skia.getContext("2d");
        if (type === "webgl" || type === "webgl2") return {
            MAX_TEXTURE_IMAGE_UNITS: 16,
            FRAGMENT_SHADER: 35632,
            HIGH_FLOAT: 36338,
            getParameter: (name: number) => name === 16 ? 16 : 16,
            getShaderPrecisionFormat: () => ({ precision: 1 }),
            getExtension: () => ({ loseContext() {} })
        };
        return null;
    }
}
