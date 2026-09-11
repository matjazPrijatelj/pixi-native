import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { DOMAdapter } from "pixi.js";
import {
  createNativeKeyboardEvent,
  createNativeMouseEvent,
  NodeDOMAdapter,
  normalizeRefreshRate,
} from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import { NodeGPUCanvas } from "@pixi-native/core/canvas/NodeGPUCanvas.js";
import { NodeCanvas } from "@pixi-native/core/canvas/NodeCanvas.js";
import { NodeGLCanvas } from "@pixi-native/core/canvas/NodeGLCanvas.js";
import { copyRgbaRowsFlippedY } from "@pixi-native/core/canvas/rgbaUpload.js";
import { sliceWebGlBufferData } from "@pixi-native/core/renderers/webgl/webglBufferUpload.js";
import {
  installWebGlImageUploadAdapter,
  type WebGlImageUploadContext,
} from "@pixi-native/core/renderers/webgl/webglImageUpload.js";
import { installWebGlMultisampleScreen } from "@pixi-native/core/renderers/webgl/webglMultisampleScreen.js";
import {
  getWindowOptionsDiagnostics,
  isTransparentWebGpuAlphaMode,
  NATIVE_BACKGROUND_COLOR,
  premultiplyBackgroundColor,
  resolveAnimationFrameRate,
  resolveNodeRendererOptions,
  resolveWebGpuAntialiasSamples,
  warnAntialiasSampleFallback,
} from "@pixi-native/core/runtime/windowOptions.js";

test("native window options normalize transparency and desktop position", () => {
  assert.deepEqual(resolveNodeRendererOptions({}, "Default title", "win32"), {
    title: "Default title",
    width: 1920,
    height: 1080,
    resizable: true,
    vsync: true,
    maxFps: undefined,
    borderless: false,
    transparent: false,
    backgroundAlpha: 1,
    antialiasSamples: 4,
    x: undefined,
    y: undefined,
  });
  assert.deepEqual(
    resolveNodeRendererOptions(
      { borderless: true, transparent: true, x: -1280, y: 120 },
      "Default title",
      "win32",
    ),
    {
      title: "Default title",
      width: 1920,
      height: 1080,
      resizable: false,
      vsync: true,
      maxFps: undefined,
      borderless: true,
      transparent: true,
      backgroundAlpha: 0,
      antialiasSamples: 4,
      x: -1280,
      y: 120,
    },
  );
  assert.throws(
    () =>
      resolveNodeRendererOptions({ borderless: true, resizable: true }, "x"),
    /mutually exclusive/,
  );
  assert.throws(
    () => resolveNodeRendererOptions({ x: 100 }, "x"),
    /provided together/,
  );
  assert.throws(
    () => resolveNodeRendererOptions({ x: 10.5, y: 20 }, "x"),
    /must be integers/,
  );
  assert.equal(
    resolveNodeRendererOptions({ transparent: true }, "x", "linux").transparent,
    true,
  );
  assert.equal(
    resolveNodeRendererOptions(
      { transparent: true, backgroundAlpha: 0.35 },
      "x",
      "win32",
    ).backgroundAlpha,
    0.35,
  );
  for (const backgroundAlpha of [Number.NaN, -0.1, 1.1]) {
    assert.throws(
      () => resolveNodeRendererOptions({ backgroundAlpha }, "x", "win32"),
      /finite number from 0 to 1/,
    );
  }
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...values: unknown[]): void => {
    warnings.push(values);
  };
  try {
    assert.equal(
      resolveNodeRendererOptions(
        { transparent: false, backgroundAlpha: 0.35 },
        "x",
        "win32",
      ).backgroundAlpha,
      1,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /backgroundAlpha below 1 is ignored/);

  assert.equal(
    resolveNodeRendererOptions({ antialiasSamples: 8 }, "x", "win32")
      .antialiasSamples,
    8,
  );
  assert.throws(
    () =>
      resolveNodeRendererOptions({ antialiasSamples: 3 as 2 }, "x", "win32"),
    /must be 0, 2, 4, or 8/,
  );
});

test("window diagnostics expose resolved options and actual position", () => {
  const options = resolveNodeRendererOptions(
    {
      title: "Diagnostics",
      width: 1280,
      height: 720,
      resizable: false,
      vsync: false,
      maxFps: 120,
      borderless: true,
      transparent: true,
      backgroundAlpha: 0.5,
      antialiasSamples: 0,
      x: 10,
      y: 20,
    },
    "Default title",
    "win32",
  );

  assert.deepEqual(getWindowOptionsDiagnostics(options, { x: 30, y: 40 }), {
    title: "Diagnostics",
    position: [30, 40],
    resizable: false,
    vsync: false,
    maxFps: 120,
    borderless: true,
    transparent: true,
    backgroundAlpha: 0.5,
    antialiasSamples: 0,
  });
});

test("MSAA fallback warnings report only changed sample counts", () => {
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...values: unknown[]): void => {
    warnings.push(values);
  };
  try {
    warnAntialiasSampleFallback("WebGL", 4, 4);
    assert.equal(resolveWebGpuAntialiasSamples(0), 0);
    assert.equal(resolveWebGpuAntialiasSamples(4), 4);
    assert.equal(resolveWebGpuAntialiasSamples(2), 4);
    assert.equal(resolveWebGpuAntialiasSamples(8), 4);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2);
  assert.match(String(warnings[0][0]), /requested 2x MSAA; using 4x/);
  assert.match(String(warnings[1][0]), /requested 8x MSAA; using 4x/);
});

test("WebGL multisample screen resolves, resizes, falls back, and cleans up", () => {
  const FRAMEBUFFER = 0x8d40;
  const DRAW_FRAMEBUFFER = 0x8ca9;
  const READ_FRAMEBUFFER = 0x8ca8;
  const FRAMEBUFFER_BINDING = 0x8ca6;
  const READ_FRAMEBUFFER_BINDING = 0x8caa;
  const RENDERBUFFER_BINDING = 0x8ca7;
  const framebuffers = [{ name: "first" }, { name: "resized" }];
  const renderbuffers = [
    { name: "first-color" },
    { name: "first-depth" },
    { name: "resized-color" },
    { name: "resized-depth" },
  ];
  const storageCalls: Array<[number, number, number]> = [];
  const blits: number[][] = [];
  const deletedFramebuffers: unknown[] = [];
  const deletedRenderbuffers: unknown[] = [];
  let drawFramebuffer: unknown = null;
  let readFramebuffer: unknown = null;
  let renderbuffer: unknown = null;

  const context = {
    FRAMEBUFFER,
    DRAW_FRAMEBUFFER,
    READ_FRAMEBUFFER,
    FRAMEBUFFER_BINDING,
    DRAW_FRAMEBUFFER_BINDING: FRAMEBUFFER_BINDING,
    READ_FRAMEBUFFER_BINDING,
    RENDERBUFFER_BINDING,
    RENDERBUFFER: 0x8d41,
    SAMPLES: 0x80a9,
    RGBA8: 0x8058,
    DEPTH24_STENCIL8: 0x88f0,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x4000,
    NEAREST: 0x2600,
    createFramebuffer: () => framebuffers.shift() ?? null,
    deleteFramebuffer: (value: unknown) => deletedFramebuffers.push(value),
    createRenderbuffer: () => renderbuffers.shift() ?? null,
    deleteRenderbuffer: (value: unknown) => deletedRenderbuffers.push(value),
    bindFramebuffer(target: number, value: unknown) {
      if (target === FRAMEBUFFER || target === DRAW_FRAMEBUFFER) {
        drawFramebuffer = value;
      }
      if (target === FRAMEBUFFER || target === READ_FRAMEBUFFER) {
        readFramebuffer = value;
      }
    },
    bindRenderbuffer: (_target: number, value: unknown) => {
      renderbuffer = value;
    },
    getParameter(parameter: number) {
      if (parameter === FRAMEBUFFER_BINDING) return drawFramebuffer;
      if (parameter === READ_FRAMEBUFFER_BINDING) return readFramebuffer;
      if (parameter === RENDERBUFFER_BINDING) return renderbuffer;
      return null;
    },
    getInternalformatParameter: (
      _target: number,
      internalFormat: number,
      _parameter: number,
    ) =>
      internalFormat === 0x8058
        ? new Int32Array([8, 4])
        : new Int32Array([4, 2]),
    getContextAttributes: () => ({ antialias: false }),
    renderbufferStorageMultisample(
      _target: number,
      samples: number,
      _format: number,
      width: number,
      height: number,
    ) {
      storageCalls.push([samples, width, height]);
    },
    framebufferRenderbuffer() {},
    checkFramebufferStatus: () => 0x8cd5,
    blitFramebuffer: (...args: number[]) => blits.push(args),
  } as unknown as WebGL2RenderingContext;

  const screen = installWebGlMultisampleScreen(context, 320, 180, 8);
  assert.equal(screen.sampleCount, 4);
  assert.equal(context.getContextAttributes()?.antialias, true);
  assert.equal(context.getParameter(context.FRAMEBUFFER_BINDING), null);
  assert.deepEqual(storageCalls, [
    [4, 320, 180],
    [4, 320, 180],
  ]);

  screen.resolve();
  assert.deepEqual(blits[0], [
    0, 0, 320, 180, 0, 0, 320, 180, context.COLOR_BUFFER_BIT, context.NEAREST,
  ]);
  screen.resize(640, 360);
  assert.deepEqual(storageCalls.slice(2), [
    [4, 640, 360],
    [4, 640, 360],
  ]);
  assert.equal(deletedFramebuffers.length, 1);
  assert.equal(deletedRenderbuffers.length, 2);

  screen.destroy();
  assert.equal(context.getContextAttributes()?.antialias, false);
  const customFramebuffer = { name: "custom" } as unknown as WebGLFramebuffer;
  context.bindFramebuffer(context.FRAMEBUFFER, customFramebuffer);
  assert.equal(
    context.getParameter(context.FRAMEBUFFER_BINDING),
    customFramebuffer,
  );
  assert.equal(deletedFramebuffers.length, 2);
  assert.equal(deletedRenderbuffers.length, 4);

  const disabled = installWebGlMultisampleScreen(context, 1, 1, 0);
  assert.equal(disabled.sampleCount, 0);
  disabled.resolve();
  assert.equal(blits.length, 1);
});

test("maxFps controls only timer-paced animation frames", () => {
  const uncappedVSync = resolveNodeRendererOptions(
    { vsync: false, maxFps: 240 },
    "x",
    "win32",
  );
  assert.equal(uncappedVSync.maxFps, 240);
  assert.equal(resolveAnimationFrameRate(uncappedVSync, 60), 240);
  assert.equal(
    resolveAnimationFrameRate(
      resolveNodeRendererOptions({ vsync: false }, "x", "win32"),
      144,
    ),
    144,
  );

  for (const maxFps of [Number.NaN, 23.9, 360.1]) {
    assert.throws(
      () => resolveNodeRendererOptions({ vsync: false, maxFps }, "x", "win32"),
      /finite number from 24 to 360/,
    );
  }

  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...values: unknown[]): void => {
    warnings.push(values);
  };
  try {
    const synchronized = resolveNodeRendererOptions(
      { vsync: true, maxFps: 240 },
      "x",
      "win32",
    );
    assert.equal(synchronized.maxFps, undefined);
    assert.equal(resolveAnimationFrameRate(synchronized, 60), 60);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /maxFps is ignored/);
});

test("Pixi 8 background RGB is premultiplied for transparent presentation", () => {
  assert.equal(isTransparentWebGpuAlphaMode("premultiplied"), true);
  assert.equal(isTransparentWebGpuAlphaMode("inherit"), true);
  assert.equal(isTransparentWebGpuAlphaMode("opaque"), false);
  assert.deepEqual(
    premultiplyBackgroundColor(NATIVE_BACKGROUND_COLOR, 0),
    [0, 0, 0],
  );
  assert.deepEqual(premultiplyBackgroundColor(NATIVE_BACKGROUND_COLOR, 0.5), [
    8 / 255,
    10.5 / 255,
    34 / 255,
  ]);
  assert.deepEqual(premultiplyBackgroundColor(NATIVE_BACKGROUND_COLOR, 1), [
    16 / 255,
    21 / 255,
    68 / 255,
  ]);
});

test("WebGL buffer upload copies are compact and independent", () => {
  const data = new Float32Array([0, 1, 2, 3, 4]);
  const sliced = sliceWebGlBufferData(data, 1, 3);

  assert.deepEqual([...sliced], [1, 2, 3]);
  assert.equal(sliced.constructor, Float32Array);
  assert.equal(sliced.byteOffset, 0);
  assert.deepEqual([...data], [0, 1, 2, 3, 4]);

  data[1] = 99;
  assert.deepEqual([...sliced], [1, 2, 3]);
});

test("SDL WebGL adapter preserves normalized Canvas row orientation", () => {
  const calls: unknown[][] = [];
  const gl = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    getParameter(parameter: number) {
      return parameter === this.UNPACK_PREMULTIPLY_ALPHA_WEBGL;
    },
    texImage2D(...args: unknown[]) {
      calls.push(args);
    },
    texSubImage2D(...args: unknown[]) {
      calls.push(args);
    },
  } satisfies WebGlImageUploadContext;
  installWebGlImageUploadAdapter(gl);
  const normalizedPixels = new Uint8Array([
    10, 20, 30, 255,
    40, 50, 60, 255,
  ]);
  const source = {
    width: 1,
    height: 2,
    getPremultipliedRgbaPixels: () => normalizedPixels,
  };

  gl.texImage2D(1, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texSubImage2D(1, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);

  assert.deepEqual(calls[0][8], normalizedPixels);
  assert.deepEqual(calls[1][8], normalizedPixels);
});

test("SDL WebGL adapter flips raw native image rows exactly once", () => {
  const calls: unknown[][] = [];
  const gl = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    getParameter: () => false,
    texImage2D(...args: unknown[]) {
      calls.push(args);
    },
    texSubImage2D(...args: unknown[]) {
      calls.push(args);
    },
  } satisfies WebGlImageUploadContext;
  installWebGlImageUploadAdapter(gl);
  const source = {
    width: 1,
    height: 2,
    data: new Uint8Array([
      10, 20, 30, 255,
      40, 50, 60, 255,
    ]),
  };
  const expected = [40, 50, 60, 255, 10, 20, 30, 255];

  gl.texImage2D(1, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texSubImage2D(1, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);

  assert.deepEqual(Array.from(calls[0][8] as Uint8Array), expected);
  assert.deepEqual(Array.from(calls[1][8] as Uint8Array), expected);
});

test("SDL WebGL adapter preserves typed-array texture uploads", () => {
  let received: unknown[] | undefined;
  const gl = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    getParameter: () => false,
    texImage2D(...args: unknown[]) {
      received = args;
    },
    texSubImage2D() {},
  } satisfies WebGlImageUploadContext;
  installWebGlImageUploadAdapter(gl);
  const pixels = new Uint8Array([1, 2, 3, 4]);

  gl.texImage2D(1, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  assert.equal(received?.[8], pixels);
});

test("NodeGLCanvas exposes WebGL and resizes the drawing buffer", () => {
  let resized: [number, number] | undefined;
  const context = {
    getExtension(name: string) {
      return name === "STACKGL_resize_drawingbuffer"
        ? {
            resize: (width: number, height: number) => {
              resized = [width, height];
            },
          }
        : null;
    },
  };
  const canvas = new NodeGLCanvas(context, 1280, 720);
  assert.equal(canvas.getContext("webgl"), context);
  assert.equal(canvas.getContext("webgl2"), context);
  assert.equal(canvas.getContext("webgpu"), null);
  canvas.resize(640.8, 360.2);
  assert.deepEqual(resized, [640, 360]);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.equal(canvas.getPremultipliedRgbaPixels().byteLength, 640 * 360 * 4);
});

test("NodeGLCanvas delegates native drawing-buffer resizing", () => {
  let resized: [number, number] | undefined;
  const canvas = new NodeGLCanvas({}, 1280, 720, (width, height) => {
    resized = [width, height];
  });

  canvas.resize(800.9, 600.4);

  assert.deepEqual(resized, [800, 600]);
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
});

test("Pixi 7 adapter patches an existing incomplete document", () => {
  const previousDocument = (globalThis as { document?: unknown }).document;
  const incompleteDocument = {
    createElement: () => null,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: incompleteDocument,
  });

  try {
    const settings = { ADAPTER: null as unknown };
    const adapter = new NodeDOMAdapter({} as never);
    adapter.installPixi7(settings);
    const documentObject = globalThis.document as unknown as {
      body: { appendChild(child: Record<string, unknown>): void };
      createElement(tagName: string): Record<string, unknown>;
    };
    const div = documentObject.createElement("div");
    assert.deepEqual(div.style, {});
    assert.ok(documentObject.body);
    assert.ok(adapter.createCanvas().getContext("2d"));
    documentObject.body.appendChild(div);
    assert.equal(div.parentNode, documentObject.body);
    assert.equal(settings.ADAPTER !== null, true);
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        writable: true,
        value: previousDocument,
      });
    }
  }
});

test("NodeDOMAdapter creates GL canvases for WebGL capability detection", () => {
  const context = { getContextAttributes: () => ({ stencil: true }) };
  const adapter = new NodeDOMAdapter(null, 60, undefined, context);
  const canvas = adapter.createCanvas(32, 16);
  assert.equal(canvas.getContext("webgl"), context);
  assert.equal(canvas.getContext("webgl2"), context);
  assert.equal(
    (
      canvas.getContext("webgl") as {
        getContextAttributes(): { stencil: boolean };
      }
    ).getContextAttributes().stencil,
    true,
  );
});

test("NodeDOMAdapter installs a file location for Pixi 7 image loading", () => {
  const globalObject = globalThis as unknown as { location?: URL };
  const previousLocation = globalObject.location;
  delete globalObject.location;
  const adapter = new NodeDOMAdapter({} as never);
  adapter.installPixi8(DOMAdapter);
  const installedLocation = (
    globalThis as unknown as {
      location?: { protocol: string };
    }
  ).location;
  assert.equal(installedLocation?.protocol, "file:");
  if (previousLocation) {
    globalObject.location = previousLocation;
  } else {
    delete globalObject.location;
  }
});

test("NodeDOMAdapter exposes WebGL 1 constructor without misclassifying WebGL 2", () => {
  class WebGLRenderingContext {}
  class WebGL2RenderingContext {}
  const context = {
    WebGLRenderingContext,
    WebGL2RenderingContext,
  };
  const adapter = new NodeDOMAdapter(null, 60, undefined, context);
  const webgl1 = adapter.getWebGLRenderingContext();

  assert.equal(webgl1, WebGLRenderingContext);
  assert.equal(
    Object.create(WebGL2RenderingContext.prototype) instanceof webgl1,
    false,
  );
});

test("NodeGPUCanvas exposes the native WebGPU context and resizes", () => {
  const context = {} as GPUCanvasContext;
  const renderer = {
    resize() {},
    getCurrentTexture() {
      return context as unknown as GPUTexture;
    },
  };
  const canvas = new NodeGPUCanvas(renderer as never, 1280, 720);
  assert.notEqual(canvas.getContext("webgpu"), null);
  assert.equal(canvas.getContext("webgpu"), canvas.getContext("webgpu"));
  assert.equal(canvas.getContext("2d"), null);
  const listener = (): void => undefined;
  assert.doesNotThrow(() => canvas.addEventListener("mousedown", listener));
  assert.doesNotThrow(() => canvas.removeEventListener("mousedown", listener));
  canvas.resize(640.8, 360.2);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
});

test("NodeGPUCanvas dispatches native mouse events to registered listeners", () => {
  const renderer = {
    resize() {},
    getCurrentTexture() {
      return {} as GPUTexture;
    },
  };
  const canvas = new NodeGPUCanvas(renderer as never);
  let received: Event | undefined;
  const listener = (event: Event): void => {
    received = event;
  };

  canvas.addEventListener("mousedown", listener);
  canvas.dispatchNativeEvent(
    "mousedown",
    createNativeMouseEvent({
      type: "mousedown",
      clientX: 123,
      clientY: 456,
      button: 0,
      buttons: 1,
    }),
  );

  assert.equal((received as Event & { clientX: number }).clientX, 123);
  assert.equal((received as Event & { clientY: number }).clientY, 456);
  canvas.removeEventListener("mousedown", listener);
});

test("NodeDOMAdapter dispatches native keyboard events to global listeners", () => {
  const adapter = new NodeDOMAdapter({} as never);
  adapter.installPixi8(DOMAdapter);
  let received: Event | undefined;
  const listener = (event: Event): void => {
    received = event;
  };
  globalThis.addEventListener("keydown", listener);

  adapter.dispatchGlobalEvent(
    "keydown",
    createNativeKeyboardEvent({
      type: "keydown",
      key: "a",
      code: "KeyA",
      repeat: true,
    }),
  );

  assert.equal((received as KeyboardEvent).key, "a");
  assert.equal((received as KeyboardEvent).code, "KeyA");
  assert.equal((received as KeyboardEvent).repeat, true);
  globalThis.removeEventListener("keydown", listener);
  adapter.dispose();
});

test("NodeDOMAdapter disposal clears native global event listeners", () => {
  const adapter = new NodeDOMAdapter({} as never);
  adapter.installPixi8(DOMAdapter);
  let calls = 0;
  globalThis.addEventListener("keydown", () => calls++);

  adapter.dispose();
  adapter.dispatchGlobalEvent("keydown", new Event("keydown"));

  assert.equal(calls, 0);
  assert.equal(adapter.dispatchModalFrame(), 0);
});

test("NodeCanvas provides a native Canvas2D context", () => {
  const canvas = new NodeCanvas(64, 32);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  assert.ok(context);
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 32);
  assert.equal(typeof context.measureText, "function");
  assert.ok(context.measureText("Pixi").width > 0);
  canvas.width = 31.9;
  canvas.height = 15.9;
  assert.equal(canvas.width, 31);
  assert.equal(canvas.height, 15);
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, 1, 1);
  assert.deepEqual(
    Array.from(context.getImageData(0, 0, 1, 1).data),
    [255, 0, 0, 255],
  );
});

test("NodeCanvas exposes premultiplied RGBA pixels", () => {
  const canvas = new NodeCanvas(1, 1);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const imageData = context.createImageData(1, 1);
  imageData.data.set([200, 100, 50, 128]);
  context.putImageData(imageData, 0, 0);

  assert.deepEqual(
    Array.from(canvas.getPremultipliedRgbaPixels()),
    [100, 50, 25, 128],
  );
});

test("RGBA upload adapter flips native image rows", () => {
  const target = new Uint8Array(16);
  const bottomUp = new Uint8Array([
    0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255,
  ]);

  copyRgbaRowsFlippedY(target, bottomUp, 2, 2);

  assert.deepEqual(
    Array.from(target),
    [255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255],
  );
});

test("NodeDOMAdapter loads a local image into a Canvas2D context", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  const image = adapter.createImage();
  await new Promise<void>((resolve, reject) => {
    image.onload = (): void => {
      Promise.resolve()
        .then(() => image.decode())
        .then(resolve, reject);
    };
    image.onerror = reject;
    image.src = fileURLToPath(
      new URL("../src/demo/assets/test-texture.png", import.meta.url),
    );
  });

  assert.ok(image.width > 0);
  assert.ok(image.height > 0);
  const canvas = new NodeCanvas(image.width, image.height);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.drawImage(image, 0, 0);
  assert.equal(context.getImageData(0, 0, 1, 1).data.length, 4);
});

test("NodeDOMAdapter loads file URLs into a native image", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  const image = adapter.createImage();
  await new Promise<void>((resolve, reject) => {
    image.onload = (): void => resolve();
    image.onerror = reject;
    image.src = new URL(
      "../src/demo/assets/bitmap-font/native-pixel.png",
      import.meta.url,
    ).href;
  });

  assert.equal(image.width, 192);
  assert.equal(image.height, 192);
});

test("NodeDOMAdapter converts file URLs for custom native image constructors", () => {
  let receivedSource = "";
  class CustomImage {
    private source = "";

    public get src(): string {
      return this.source;
    }

    public set src(value: string) {
      this.source = value;
      receivedSource = value;
    }
  }

  const adapter = new NodeDOMAdapter(
    {} as never,
    60,
    undefined,
    undefined,
    CustomImage,
  );
  const image = adapter.createImage();
  const expectedPath = fileURLToPath(
    new URL("../src/demo/assets/bitmap-font/native-pixel.png", import.meta.url),
  );

  image.src = new URL(
    "../src/demo/assets/bitmap-font/native-pixel.png",
    import.meta.url,
  ).href;

  assert.equal(receivedSource, expectedPath);
  assert.equal(image.src, expectedPath);
});

test("NodeDOMAdapter fetches absolute paths and file URLs without HTTP", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  const fontUrl = new URL(
    "../src/demo/assets/bitmap-font/native-pixel.fnt",
    import.meta.url,
  );

  const absoluteResponse = await adapter.fetch(fileURLToPath(fontUrl));
  const fileUrlResponse = await adapter.fetch(fontUrl);

  assert.equal(absoluteResponse.status, 200);
  assert.match(await absoluteResponse.text(), /face="NativePixel"/);
  assert.match(await fileUrlResponse.text(), /chars count=43/);
});

test("NodeDOMAdapter delegates non-file URLs to the global fetch", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | undefined;
  globalThis.fetch = async (input): Promise<Response> => {
    requestedUrl = input.toString();
    return new Response("remote font");
  };

  try {
    const response = await adapter.fetch("https://example.invalid/font.fnt");
    assert.equal(requestedUrl, "https://example.invalid/font.fnt");
    assert.equal(await response.text(), "remote font");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("display refresh rates are validated for frame scheduling", () => {
  assert.equal(normalizeRefreshRate(59.94), 59.94);
  assert.equal(normalizeRefreshRate(144), 144);
  assert.equal(normalizeRefreshRate(0), 60);
  assert.equal(normalizeRefreshRate(Number.NaN), 60);
});
