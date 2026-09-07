/** Canvas-like object backed by a native Skia Canvas2D surface. */
export declare class NodeCanvas {
    readonly style: Record<string, string>;
    private readonly canvas;
    constructor(width?: number, height?: number);
    get width(): number;
    set width(value: number);
    get height(): number;
    set height(value: number);
    getContext(type: string): unknown;
    /** Returns Skia's native premultiplied pixels in RGBA byte order. */
    getPremultipliedRgbaPixels(): Uint8Array;
}
