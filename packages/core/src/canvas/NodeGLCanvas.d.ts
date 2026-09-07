/** HTMLCanvasElement-shaped surface backed by a native WebGL2 context. */
export declare class NodeGLCanvas {
    readonly style: Record<string, string>;
    private _width;
    private _height;
    private readonly context;
    private readonly canvas2d;
    private readonly resizeDrawingBuffer?;
    private readonly listeners;
    constructor(context: unknown, width?: number, height?: number, resizeDrawingBuffer?: (width: number, height: number) => void);
    get width(): number;
    set width(value: number);
    get height(): number;
    set height(value: number);
    get clientWidth(): number;
    get clientHeight(): number;
    getBoundingClientRect(): DOMRect;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    dispatchNativeEvent(type: string, event: Event): void;
    getContext(type: string): unknown;
    /** Returns a stable copy source for the WebGL native image upload adapter. */
    getPremultipliedRgbaPixels(): Uint8Array;
    get data(): Buffer;
    resize(width: number, height: number): void;
}
