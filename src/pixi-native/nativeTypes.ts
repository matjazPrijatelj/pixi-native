export interface NodeGPUInstance {
  requestAdapter(options?: Record<string, unknown>): Promise<GPUAdapter | null>;
}

export type AntialiasSamples = 0 | 2 | 4 | 8;

export const DEFAULT_ANTIALIAS_SAMPLES: AntialiasSamples = 4;

export interface NodeRendererOptions {
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
  readonly resizable?: boolean;
  readonly vsync?: boolean;
  /** Caps timer-paced RAF when VSync is disabled. Defaults to display refresh. */
  readonly maxFps?: number;
  /** Creates an undecorated window. Borderless windows are not user-resizable. */
  readonly borderless?: boolean;
  /** Enables per-pixel transparency when supported by the desktop compositor. */
  readonly transparent?: boolean;
  /** Pixi background opacity. Opaque windows normalize values below 1 to 1. */
  readonly backgroundAlpha?: number;
  /** Requested MSAA samples. Defaults to 4; 0 disables antialiasing. */
  readonly antialiasSamples?: AntialiasSamples;
  /** Absolute virtual-desktop X coordinate. Must be provided with `y`. */
  readonly x?: number;
  /** Absolute virtual-desktop Y coordinate. Must be provided with `x`. */
  readonly y?: number;
}

export interface NodeGPUApi {
  createWindowContext(options: {
    flags: string[];
    window: unknown;
    presentMode?: string;
    alphaMode?: "opaque" | "premultiplied";
  }): {
    gpu: NodeGPUInstance;
    adapter: GPUAdapter;
    device: GPUDevice;
    renderer: NodeWindowRenderer;
  };
  destroy(context: object): void;
}

export interface NodeWindowRenderer {
  getPreferredFormat(): GPUTextureFormat;
  getCurrentTexture(): GPUTexture;
  getCurrentTextureView(): GPUTextureView;
  swap(): void;
  resize(): void;
  destroy(): void;
}

export interface NodeRenderSurface {
  resize(width: number, height: number): void;
  swap(): void;
  destroy(): void;
}

export interface NodeWindowHandle {
  readonly x: number;
  readonly y: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly display: { readonly frequency: number };
  readonly destroyed: boolean;
  readonly pollEvents?: () => void;
  setPosition(x: number, y: number): void;
  minimize(): void;
  maximize(): void;
  restore(): void;
  on(event: string, listener: (event: any) => void): void;
  destroy(): void;
}

export interface NodeNativeInput {
  dispatchCanvasEvent(type: string, event: Event): void;
  dispatchGlobalEvent(type: string, event: Event): void;
}
