export interface NodeGPUInstance {
  requestAdapter(options?: Record<string, unknown>): Promise<GPUAdapter | null>;
}

export interface NodeGPUApi {
  create(flags: string[]): NodeGPUInstance;
  renderGPUDeviceToWindow(options: {
    device: GPUDevice;
    window: unknown;
    presentMode?: string;
  }): NodeWindowRenderer;
  destroy(instance: NodeGPUInstance): void;
}

export interface NodeWindowRenderer {
  getPreferredFormat(): GPUTextureFormat;
  getCurrentTexture(): GPUTexture;
  getCurrentTextureView(): GPUTextureView;
  swap(): void;
  waitForPresent?(): Promise<boolean>;
  resize(): void;
  destroy(): void;
}

export interface NodeRenderSurface {
  resize(width: number, height: number): void;
  swap(): void;
  destroy(): void;
}

export interface NodeWindowHandle {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly display: { readonly frequency: number };
  readonly destroyed: boolean;
  readonly pollEvents?: () => void;
  on(event: string, listener: (event: any) => void): void;
  destroy(): void;
}

export interface NodeNativeInput {
  dispatchCanvasEvent(type: string, event: Event): void;
  dispatchGlobalEvent(type: string, event: Event): void;
}
