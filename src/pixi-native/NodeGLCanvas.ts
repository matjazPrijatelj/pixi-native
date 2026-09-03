import { NodeCanvas } from "./NodeCanvas.ts";

/** HTMLCanvasElement-shaped surface backed by a native WebGL2 context. */
export class NodeGLCanvas {
  public readonly style: Record<string, string> = {};
  public width: number;
  public height: number;

  private readonly context: unknown;
  private readonly canvas2d: NodeCanvas;
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  public constructor(context: unknown, width = 1280, height = 720) {
    this.context = context;
    this.canvas2d = new NodeCanvas(width, height);
    this.width = width;
    this.height = height;
  }

  public get clientWidth(): number { return this.width; }
  public get clientHeight(): number { return this.height; }

  public getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: this.width, height: this.height,
      right: this.width, bottom: this.height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  }

  public addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    let listeners = this.listeners.get(type);
    if (!listeners) { listeners = new Set(); this.listeners.set(type, listeners); }
    listeners.add(listener);
  }

  public removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.listeners.delete(type);
  }

  public dispatchNativeEvent(type: string, event: Event): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

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

  public resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.canvas2d.width = this.width;
    this.canvas2d.height = this.height;
    const extension = (this.context as { getExtension?: (name: string) => unknown })
      .getExtension?.("STACKGL_resize_drawingbuffer") as { resize(width: number, height: number): void } | null | undefined;
    extension?.resize(this.width, this.height);
  }
}
