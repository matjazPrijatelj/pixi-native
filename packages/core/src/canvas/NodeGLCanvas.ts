import { NodeCanvas } from "./NodeCanvas.ts";

/** HTMLCanvasElement-shaped surface backed by a native WebGL2 context. */
export class NodeGLCanvas {
  public readonly style: Record<string, string> = {};
  private _width: number;
  private _height: number;

  private readonly context: unknown;
  private readonly canvas2d: NodeCanvas;
  private readonly resizeDrawingBuffer?: (
    width: number,
    height: number,
  ) => void;
  private readonly listeners = new Map<
    string,
    Set<EventListenerOrEventListenerObject>
  >();

  /** Wraps a native WebGL context in the canvas shape expected by Pixi. */
  public constructor(
    context: unknown,
    width = 1280,
    height = 720,
    resizeDrawingBuffer?: (width: number, height: number) => void,
  ) {
    this.context = context;
    this.canvas2d = new NodeCanvas(width, height);
    this._width = width;
    this._height = height;
    this.resizeDrawingBuffer = resizeDrawingBuffer;
  }

  public get width(): number {
    return this._width;
  }

  public set width(value: number) {
    this._width = Math.max(1, Math.floor(value));
    this.canvas2d.width = this._width;
  }

  public get height(): number {
    return this._height;
  }

  public set height(value: number) {
    this._height = Math.max(1, Math.floor(value));
    this.canvas2d.height = this._height;
  }

  public get clientWidth(): number {
    return this.width;
  }
  public get clientHeight(): number {
    return this.height;
  }

  /** Returns a viewport-aligned rectangle for Pixi pointer normalization. */
  public getBoundingClientRect(): DOMRect {
    return {
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
      right: this.width,
      bottom: this.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.listeners.delete(type);
  }

  /** Delivers a translated native event to registered canvas listeners. */
  public dispatchNativeEvent(type: string, event: Event): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  /** Returns the wrapped WebGL context or the auxiliary Canvas2D context. */
  public getContext(type: string): unknown {
    if (type === "2d") return this.canvas2d.getContext("2d");
    return type === "webgl" || type === "webgl2" ? this.context : null;
  }

  /** Returns a stable copy source for the WebGL native image upload adapter. */
  public getPremultipliedRgbaPixels(): Uint8Array {
    return this.canvas2d.getPremultipliedRgbaPixels();
  }

  public get data(): Buffer {
    return Buffer.from(this.canvas2d.getPremultipliedRgbaPixels());
  }

  /** Resizes the canvas and native WebGL drawing buffer in physical pixels. */
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    if (this.resizeDrawingBuffer) {
      this.resizeDrawingBuffer(this.width, this.height);
      return;
    }
    const extension = (
      this.context as { getExtension?: (name: string) => unknown }
    ).getExtension?.("STACKGL_resize_drawingbuffer") as
      | { resize(width: number, height: number): void }
      | null
      | undefined;
    extension?.resize(this.width, this.height);
  }
}
