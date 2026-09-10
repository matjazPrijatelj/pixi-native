import type {
  NativeSurfaceDescriptor,
  NodeWindowHandle,
} from "../../runtime/nativeTypes.ts";

export interface GlfwWindowMouseEvent {
  readonly x: number;
  readonly y: number;
  readonly button: number;
}

export interface GlfwWindowKeyEvent {
  readonly key: string | null;
  readonly code: string | null;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly scancode: number;
}

export type GlfwEvent = Record<string, unknown>;

export interface GlfwWindowLike {
  readonly framebufferSize: { width: number; height: number };
  readonly x: number;
  readonly y: number;
  pos: { x: number; y: number };
  readonly shouldClose: boolean;
  readonly platformDevice?: number;
  readonly platformWindow: number;
  getCurrentMonitor(): { rate: number } | null;
  makeCurrent?(): void;
  swapBuffers?(): void;
  drawWindow?(callback: (timestamp: number) => void): void;
  iconify(): void;
  restore(): void;
  destroy(): void;
  on(event: string, listener: (event: GlfwEvent) => void): void;
}

export interface GlfwWindowApi {
  readonly platform?: NativeSurfaceDescriptor["platform"];
  pollEvents(): void;
  maximize(): void;
}

type GlfwPlatformApi = {
  readonly PLATFORM_WIN32: number;
  readonly PLATFORM_X11: number;
  readonly PLATFORM_WAYLAND: number;
  getPlatform(): number;
};

/** Maps GLFW's runtime platform constant to the Dawn surface discriminator. */
export function resolveGlfwSurfacePlatform(
  glfw: GlfwPlatformApi,
): NativeSurfaceDescriptor["platform"] {
  const platform = glfw.getPlatform();
  if (platform === glfw.PLATFORM_WIN32) return "win32";
  if (platform === glfw.PLATFORM_X11) return "x11";
  if (platform === glfw.PLATFORM_WAYLAND) return "wayland";
  throw new Error(`Unsupported GLFW surface platform: ${platform}`);
}

/** Serializes a native GLFW handle without exposing pointer-shaped numbers to the GPU addon. */
export function encodeGlfwHandle(handle: number, name: string): Uint8Array {
  if (!Number.isSafeInteger(handle) || handle <= 0) {
    throw new Error(`Invalid native GLFW ${name} handle: ${handle}`);
  }
  const data = new Uint8Array(process.arch === "ia32" ? 4 : 8);
  const view = new DataView(data.buffer);
  if (data.byteLength === 4) view.setUint32(0, handle, true);
  else view.setBigUint64(0, BigInt(handle), true);
  return data;
}

/** Adapts GLFW events and platform handles to the renderer-neutral native window API. */
export class NodeGlfwWindow implements NodeWindowHandle {
  private isDestroyed = false;
  private closeNotified = false;
  private readonly closeListeners = new Set<(event: unknown) => void>();
  private readonly glfwWindow: GlfwWindowLike;
  private readonly glfw: GlfwWindowApi;

  public constructor(glfwWindow: GlfwWindowLike, glfw: GlfwWindowApi) {
    this.glfwWindow = glfwWindow;
    this.glfw = glfw;
  }

  public get x(): number {
    return this.glfwWindow.x;
  }

  public get y(): number {
    return this.glfwWindow.y;
  }

  public get pixelWidth(): number {
    return this.glfwWindow.framebufferSize.width;
  }

  public get pixelHeight(): number {
    return this.glfwWindow.framebufferSize.height;
  }

  /** Encodes the native window handle for the Windows modal-loop bridge. */
  public get nativeWindowData(): Uint8Array {
    return encodeGlfwHandle(this.glfwWindow.platformWindow, "window");
  }

  /** Describes the platform-native window pair used to create a Dawn surface. */
  public get nativeSurface(): NativeSurfaceDescriptor {
    if (!this.glfw.platform) {
      throw new Error("GLFW surface platform is unavailable");
    }
    const window = this.nativeWindowData;
    if (this.glfw.platform === "win32") return { platform: "win32", window };
    return {
      platform: this.glfw.platform,
      window,
      display: encodeGlfwHandle(this.glfwWindow.platformDevice ?? 0, "display"),
    };
  }

  public get display(): { readonly frequency: number } {
    return { frequency: this.glfwWindow.getCurrentMonitor()?.rate ?? 60 };
  }

  public get destroyed(): boolean {
    return this.isDestroyed;
  }

  public pollEvents(): void {
    this.glfw.pollEvents();
    if (this.glfwWindow.shouldClose && !this.closeNotified) {
      this.closeNotified = true;
      for (const listener of this.closeListeners) listener({ type: "close" });
    }
  }

  public makeCurrent(): void {
    if (!this.glfwWindow.makeCurrent) {
      throw new Error("GLFW window has no OpenGL context");
    }
    this.glfwWindow.makeCurrent();
  }

  public swapBuffers(): void {
    if (!this.glfwWindow.swapBuffers) {
      throw new Error("GLFW window has no OpenGL swap chain");
    }
    this.glfwWindow.swapBuffers();
  }

  public drawWindow(callback: (timestamp: number) => void): void {
    if (!this.glfwWindow.drawWindow) {
      throw new Error("GLFW window has no OpenGL draw loop");
    }
    this.glfwWindow.drawWindow(callback);
  }

  public setPosition(x: number, y: number): void {
    this.assertAlive();
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new Error("window x and y must be integers");
    }
    this.glfwWindow.pos = { x, y };
  }

  public minimize(): void {
    this.assertAlive();
    this.glfwWindow.iconify();
  }

  public maximize(): void {
    this.assertAlive();
    this.glfw.maximize();
  }

  public restore(): void {
    this.assertAlive();
    this.glfwWindow.restore();
  }

  public on(event: string, listener: (event: unknown) => void): void {
    const eventMap: Record<string, string> = {
      resize: "resize",
      close: "close",
      mouseButtonDown: "mousedown",
      mouseButtonUp: "mouseup",
      mouseMove: "mousemove",
      mouseWheel: "wheel",
      keyDown: "keydown",
      keyUp: "keyup",
    };
    if (event === "close") {
      this.closeListeners.add(listener);
      return;
    }
    const glfwEvent = eventMap[event];
    if (!glfwEvent) {
      throw new Error(`Unsupported native GLFW window event: ${event}`);
    }
    this.glfwWindow.on(glfwEvent, (raw) =>
      listener(this.normalize(event, raw)),
    );
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.glfwWindow.destroy();
    this.closeListeners.clear();
  }

  private assertAlive(): void {
    if (this.isDestroyed) throw new Error("window is destroyed");
  }

  private normalize(event: string, raw: GlfwEvent): unknown {
    if (event === "resize") {
      return { width: this.pixelWidth, height: this.pixelHeight };
    }
    if (
      event === "mouseButtonDown" ||
      event === "mouseButtonUp" ||
      event === "mouseMove"
    ) {
      return {
        x: Number(raw.x ?? 0),
        y: Number(raw.y ?? 0),
        button: Number(raw.button ?? 0),
      } satisfies GlfwWindowMouseEvent;
    }
    if (event === "mouseWheel") {
      return {
        x: Number(raw.x ?? 0),
        y: Number(raw.y ?? 0),
        dx: Number(raw.deltaX ?? raw.dx ?? 0),
        dy: Number(raw.deltaY ?? raw.dy ?? 0),
        flipped: false,
      };
    }
    if (event === "keyDown" || event === "keyUp") {
      return {
        key: typeof raw.key === "string" ? raw.key : null,
        code: typeof raw.code === "string" ? raw.code : null,
        repeat: Boolean(raw.repeat),
        ctrlKey: Boolean(raw.ctrlKey),
        shiftKey: Boolean(raw.shiftKey),
        altKey: Boolean(raw.altKey),
        metaKey: Boolean(raw.metaKey),
        scancode: Number(raw.which ?? 0),
      } satisfies GlfwWindowKeyEvent;
    }
    return raw;
  }
}
