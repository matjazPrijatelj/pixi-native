const { EventEmitter } = require("node:events");
const Fs = require("node:fs");
const { createRequire } = require("node:module");
const { getBindingPath } = require("../binding-path.js");

const requireNative = createRequire(__filename);
const bindingPath = getBindingPath();
if (!Fs.existsSync(bindingPath)) {
  throw new Error(
    `Native window addon not found for ${process.platform}-${process.arch}. Run pnpm native:window:build.`,
  );
}

const binding = requireNative(bindingPath);
const windows = new Map();
let waylandPositionWarned = false;

class NativeWindow extends EventEmitter {
  constructor(options) {
    super();
    this._nativeWindow = new binding.NativeSdlWindow(options);
    windows.set(this._nativeWindow.id, this);
  }

  get id() { return this._nativeWindow.id; }
  get x() { return this._nativeWindow.x; }
  get y() { return this._nativeWindow.y; }
  get pixelWidth() { return this._nativeWindow.pixelWidth; }
  get pixelHeight() { return this._nativeWindow.pixelHeight; }
  get display() { return { frequency: this._nativeWindow.refreshRate }; }
  get destroyed() { return this._nativeWindow.destroyed; }
  get surface() { return this._nativeWindow.surface; }
  get videoDriver() { return this._nativeWindow.videoDriver; }
  get transparent() { return this._nativeWindow.transparent; }

  pollEvents() { pollEvents(); }

  setPosition(x, y) {
    if (this._nativeWindow.setPosition(x, y)) return;
    if (!waylandPositionWarned) {
      waylandPositionWarned = true;
      console.warn(
        "[pixi-native] SDL3 Wayland ignores absolute toplevel window positioning.",
      );
    }
  }

  minimize() { this._nativeWindow.minimize(); }
  maximize() { this._nativeWindow.maximize(); }
  restore() { this._nativeWindow.restore(); }
  makeGlCurrent() { return this._nativeWindow.makeGlCurrent(); }
  setGlSwapInterval(interval) { return this._nativeWindow.setGlSwapInterval(interval); }
  swapGl() { return this._nativeWindow.swapGl(); }
  glVersion() { return this._nativeWindow.glVersion(); }

  destroy() {
    if (this.destroyed) return;
    windows.delete(this.id);
    this._nativeWindow.destroy();
    this.removeAllListeners();
  }
}

const emitNativeEvent = (window, event) => {
  const { kind, windowId, superKey, ...payload } = event;
  window.emit(kind, { ...payload, type: kind, super: superKey });
};

const pollEvents = () => {
  for (const event of binding.pollEvents()) {
    if (event.kind === "quit") {
      for (const window of [...windows.values()]) {
        emitNativeEvent(window, { ...event, kind: "close" });
      }
      continue;
    }
    const window = windows.get(event.windowId);
    if (window) emitNativeEvent(window, event);
  }
};

const createWindow = (options) => new NativeWindow(options);
const waitForCompositorFrame = (timeoutMs) =>
  binding.waitForCompositorFrame(timeoutMs);
const createModalFrameController = (nativeData, onFrame, onState) => {
  const controller = new binding.ModalFrameController(nativeData, onFrame, onState);
  controller.attach();
  return controller;
};

module.exports = {
  NativeWindow,
  createWindow,
  createModalFrameController,
  pollEvents,
  waitForCompositorFrame,
};
