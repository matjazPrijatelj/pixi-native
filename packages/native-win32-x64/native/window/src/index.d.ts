export interface NativeSurfaceDescriptor {
  readonly version: 1;
  readonly api: "win32" | "x11" | "wayland";
  readonly window: Buffer;
  readonly display?: Buffer;
  readonly instance?: Buffer;
  readonly eglWindow?: Buffer;
}

export interface NativeWindowOptions {
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly resizable: boolean;
  readonly borderless: boolean;
  readonly transparent: boolean;
  readonly x?: number;
  readonly y?: number;
  readonly graphics: "webgpu" | "webgl";
}

export interface NativeWindow {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly display: { readonly frequency: number };
  readonly destroyed: boolean;
  readonly surface: NativeSurfaceDescriptor;
  readonly videoDriver: string;
  readonly transparent: boolean;
  pollEvents(): void;
  setPosition(x: number, y: number): void;
  minimize(): void;
  maximize(): void;
  restore(): void;
  makeGlCurrent(): boolean;
  setGlSwapInterval(interval: number): boolean;
  swapGl(): boolean;
  glVersion(): string;
  on(event: string, listener: (event: Record<string, unknown>) => void): this;
  destroy(): void;
}

export interface ModalFrameController {
  attach(): void;
  detach(): void;
}

export interface NativeWindowApi {
  createWindow(options: NativeWindowOptions): NativeWindow;
  pollEvents(): void;
  waitForCompositorFrame(timeoutMs?: number): Promise<boolean>;
  createModalFrameController(
    nativeData: Buffer,
    onFrame: () => void,
    onState: (active: boolean) => void,
  ): ModalFrameController;
}

declare const nativeWindow: NativeWindowApi;
export = nativeWindow;
