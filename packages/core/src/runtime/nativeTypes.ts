export interface NodeGPUInstance {
  requestAdapter(options?: Record<string, unknown>): Promise<GPUAdapter | null>;
}

export type AntialiasSamples = 0 | 2 | 4 | 8;

export const DEFAULT_ANTIALIAS_SAMPLES: AntialiasSamples = 4;

export interface NodeRendererOptions {
  /** Native window title. */
  readonly title?: string;
  /** Initial client width in physical pixels. */
  readonly width?: number;
  /** Initial client height in physical pixels. */
  readonly height?: number;
  /** Allows a decorated window to be resized by the user. */
  readonly resizable?: boolean;
  /** Synchronizes presentation to the display when supported. */
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
    requestedAlphaMode?: "opaque" | "premultiplied";
    alphaMode?: "opaque" | "premultiplied";
  };
  destroy(context: object): void;
}

export interface NodeWindowRenderer {
    getPreferredFormat(): GPUTextureFormat;
    getAlphaMode?(): "opaque" | "premultiplied";
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
  /** Current virtual-desktop X coordinate. */
  readonly x: number;
  /** Current virtual-desktop Y coordinate. */
  readonly y: number;
  /** Current drawable width in physical pixels. */
  readonly pixelWidth: number;
  /** Current drawable height in physical pixels. */
  readonly pixelHeight: number;
  /** Display information reported by the native window backend. */
  readonly display: { readonly frequency: number };
  /** Whether the native window has already been released. */
  readonly destroyed: boolean;
  /** Polls pending native events when the backend requires explicit polling. */
  readonly pollEvents?: () => void;
  /** Moves the window to an absolute virtual-desktop position. */
  setPosition(x: number, y: number): void;
  /** Minimizes the native window. */
  minimize(): void;
  /** Maximizes the native window. */
  maximize(): void;
  /** Restores a minimized or maximized window. */
  restore(): void;
  /** Registers a native window event listener. */
  on(event: string, listener: (event: any) => void): void;
  /** Releases the native window. Prefer the managed application's destroy method. */
  destroy(): void;
}

/** Event bridge exposed by manually managed renderer contexts. */
export interface NodeNativeInput {
  /** Dispatches a translated event to the renderer canvas. */
  dispatchCanvasEvent(type: string, event: Event): void;
  /** Dispatches a translated event to global document/window listeners. */
  dispatchGlobalEvent(type: string, event: Event): void;
}
