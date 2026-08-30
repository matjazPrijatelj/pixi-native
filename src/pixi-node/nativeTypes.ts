export interface NodeGPUInstance {
    requestAdapter(options?: Record<string, unknown>): Promise<GPUAdapter | null>;
}

export interface NodeGPUApi {
    create(flags: string[]): NodeGPUInstance;
    renderGPUDeviceToWindow(options: { device: GPUDevice; window: unknown; presentMode?: string }): NodeWindowRenderer;
    destroy(instance: NodeGPUInstance): void;
}

export interface NodeWindowRenderer {
    getPreferredFormat(): GPUTextureFormat;
    getCurrentTexture(): GPUTexture;
    getCurrentTextureView(): GPUTextureView;
    swap(): void;
    resize(): void;
    destroy(): void;
}

export interface NodeSDLApi {
    video: { createWindow(options: { title: string; width: number; height: number; resizable: boolean; webgpu: boolean }): NodeSDLWindow };
}

export interface NodeSDLKeyDownEvent {
    readonly key: string | null;
    readonly repeat: boolean;
}

export interface NodeSDLWindow {
    readonly width: number;
    readonly height: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly destroyed: boolean;
    on(event: "resize" | "close", listener: (event: unknown) => void): NodeSDLWindow;
    on(event: "keyDown", listener: (event: NodeSDLKeyDownEvent) => void): NodeSDLWindow;
    destroy(): void;
}
