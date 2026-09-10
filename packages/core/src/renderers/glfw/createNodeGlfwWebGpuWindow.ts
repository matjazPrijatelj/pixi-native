import { EventEmitter } from "node:events";
import type { ResolvedNodeRendererOptions } from "../../runtime/windowOptions.ts";
import {
  NodeGlfwWindow,
  resolveGlfwSurfacePlatform,
  type GlfwEvent,
  type GlfwWindowLike,
} from "./NodeGlfwWindow.ts";

interface RawGlfwMonitor {
  readonly is_primary: boolean;
  readonly pos_x: number;
  readonly pos_y: number;
  readonly width: number;
  readonly height: number;
  readonly rate: number;
}

export interface RawGlfwApi {
  readonly TRUE: number;
  readonly FALSE: number;
  readonly CLIENT_API: number;
  readonly NO_API: number;
  readonly OPENGL_API: number;
  readonly ALPHA_BITS: number;
  readonly RESIZABLE: number;
  readonly VISIBLE: number;
  readonly DECORATED: number;
  readonly TRANSPARENT_FRAMEBUFFER: number;
  readonly PLATFORM_WIN32: number;
  readonly PLATFORM_X11: number;
  readonly PLATFORM_WAYLAND: number;
  defaultWindowHints(): void;
  windowHint(hint: number, value: number): void;
  createWindow(
    width: number,
    height: number,
    emitter: { emit(type: string, event: GlfwEvent): boolean },
    title?: string,
    monitorIndex?: number,
    noApi?: boolean,
  ): unknown;
  destroyWindow(window: unknown): void;
  getWindowPos(window: unknown): { x: number; y: number };
  setWindowPos(window: unknown, x: number, y: number): void;
  getWindowSize(window: unknown): { width: number; height: number };
  getFramebufferSize(window: unknown): { width: number; height: number };
  windowShouldClose(window: unknown): number;
  getMonitors(): RawGlfwMonitor[];
  platformDevice(): number;
  platformWindow(window: unknown): number;
  getPlatform(): number;
  pollEvents(): void;
  maximizeWindow(window: unknown): void;
  iconifyWindow(window: unknown): void;
  restoreWindow(window: unknown): void;
  makeContextCurrent(window: unknown): void;
  swapBuffers(window: unknown): void;
  swapInterval(interval: number): void;
}

type KeyMap = Readonly<Record<number, string>>;

/** Applies GLFW hints and creates the window used by the Dawn surface. */
export function openGlfwWebGpuWindow(
  glfw: RawGlfwApi,
  options: ResolvedNodeRendererOptions,
  emitter: { emit(type: string, event: GlfwEvent): boolean },
  platform: NodeJS.Platform = process.platform,
): unknown {
  const usesTransparentBacking =
    platform === "win32" && options.transparent;
  glfw.defaultWindowHints();
  glfw.windowHint(
    glfw.CLIENT_API,
    usesTransparentBacking ? glfw.OPENGL_API : glfw.NO_API,
  );
  if (usesTransparentBacking) glfw.windowHint(glfw.ALPHA_BITS, 8);
  glfw.windowHint(glfw.RESIZABLE, options.resizable ? glfw.TRUE : glfw.FALSE);
  glfw.windowHint(glfw.VISIBLE, glfw.TRUE);
  glfw.windowHint(glfw.DECORATED, options.borderless ? glfw.FALSE : glfw.TRUE);
  glfw.windowHint(
    glfw.TRANSPARENT_FRAMEBUFFER,
    options.transparent ? glfw.TRUE : glfw.FALSE,
  );
  return glfw.createWindow(
    options.width,
    options.height,
    emitter,
    options.title,
    undefined,
    !usesTransparentBacking,
  );
}

/** Creates the GLFW window used by the Dawn/WebGPU surface. */
export async function createNodeGlfwWebGpuWindow(
  options: ResolvedNodeRendererOptions,
): Promise<NodeGlfwWindow> {
  const glfwModule = await import("@node-3d/glfw");
  const glfw = glfwModule.glfw as unknown as RawGlfwApi;
  const keyNames = glfwModule.keyNames as KeyMap;
  const codeNames = glfwModule.codeNames as KeyMap;
  const extraCodes = glfwModule.extraCodes as Readonly<Record<number, number>>;
  const events = new EventEmitter();
  const emitter = {
    emit(type: string, raw: GlfwEvent): boolean {
      const event = normalizeRawGlfwEvent(
        type,
        raw,
        keyNames,
        codeNames,
        extraCodes,
      );
      return events.emit(type, event);
    },
  };

  const handle = openGlfwWebGpuWindow(glfw, options, emitter);
  if (!handle) throw new Error("GLFW could not create a WebGPU window");

  if (process.platform === "win32" && options.transparent) {
    const { gl } = await import("@node-3d/core");
    const clearTransparentBacking = (): void => {
      glfw.makeContextCurrent(handle);
      glfw.swapInterval(0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      glfw.swapBuffers(handle);
    };
    clearTransparentBacking();
    events.on("resize", clearTransparentBacking);
  }

  const rawWindow: GlfwWindowLike = {
    get framebufferSize() {
      return glfw.getFramebufferSize(handle);
    },
    get x() {
      return glfw.getWindowPos(handle).x;
    },
    get y() {
      return glfw.getWindowPos(handle).y;
    },
    get pos() {
      return glfw.getWindowPos(handle);
    },
    set pos(position) {
      glfw.setWindowPos(handle, position.x, position.y);
    },
    get shouldClose() {
      return glfw.windowShouldClose(handle) !== 0;
    },
    get platformDevice() {
      return glfw.platformDevice();
    },
    get platformWindow() {
      return glfw.platformWindow(handle);
    },
    getCurrentMonitor: () => findCurrentMonitor(glfw, handle),
    iconify: () => glfw.iconifyWindow(handle),
    restore: () => glfw.restoreWindow(handle),
    destroy: () => glfw.destroyWindow(handle),
    on: (event, listener) => {
      events.on(event, listener);
    },
  };
  const window = new NodeGlfwWindow(rawWindow, {
    platform: resolveGlfwSurfacePlatform(glfw),
    pollEvents: () => glfw.pollEvents(),
    maximize: () => glfw.maximizeWindow(handle),
  });
  if (options.x !== undefined && options.y !== undefined) {
    window.setPosition(options.x, options.y);
  }
  return window;
}

function findCurrentMonitor(
  glfw: RawGlfwApi,
  window: unknown,
): RawGlfwMonitor | null {
  const monitors = glfw.getMonitors();
  if (monitors.length === 0) return null;
  const position = glfw.getWindowPos(window);
  const size = glfw.getWindowSize(window);
  let selected = monitors.find((monitor) => monitor.is_primary) ?? monitors[0];
  let selectedOverlap = -1;
  for (const monitor of monitors) {
    const horizontal = Math.max(
      0,
      Math.min(position.x + size.width, monitor.pos_x + monitor.width) -
        Math.max(position.x, monitor.pos_x),
    );
    const vertical = Math.max(
      0,
      Math.min(position.y + size.height, monitor.pos_y + monitor.height) -
        Math.max(position.y, monitor.pos_y),
    );
    const overlap = horizontal * vertical;
    if (overlap > selectedOverlap) {
      selected = monitor;
      selectedOverlap = overlap;
    }
  }
  return selected;
}

function normalizeRawGlfwEvent(
  type: string,
  raw: GlfwEvent,
  keyNames: KeyMap,
  codeNames: KeyMap,
  extraCodes: Readonly<Record<number, number>>,
): GlfwEvent {
  if (type !== "keydown" && type !== "keyup") return raw;
  const glfwCode = Number(raw.which ?? 0);
  const which = extraCodes[glfwCode] ?? glfwCode;
  const charCode = Number(raw.charCode ?? 0);
  const rawCode = typeof raw.code === "string" ? raw.code : "";
  return {
    ...raw,
    which,
    keyCode: which,
    key:
      (charCode > 0 ? String.fromCodePoint(charCode) : undefined) ??
      (rawCode || keyNames[glfwCode] || "?"),
    code:
      codeNames[glfwCode] ||
      (rawCode ? `Key${rawCode.toUpperCase()}` : "UNKNOWN"),
  };
}
