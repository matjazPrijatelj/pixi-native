import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
    createNativeKeyboardEvent,
    createNativeMouseEvent,
    NodeDOMAdapter,
    normalizeRefreshRate,
} from "../../pixi-native/NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "../../pixi-native/NodeGPUCanvas.ts";
import { NodeCanvas } from "../../pixi-native/NodeCanvas.ts";
import { NodeGLCanvas } from "../../pixi-native/NodeGLCanvas.ts";

test("NodeGLCanvas exposes WebGL and resizes the drawing buffer", () => {
    let resized: [number, number] | undefined;
    const context = {
        getExtension(name: string) {
            return name === "STACKGL_resize_drawingbuffer"
                ? { resize: (width: number, height: number) => { resized = [width, height]; } }
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
});

test("NodeDOMAdapter creates GL canvases for WebGL capability detection", () => {
    const context = { getContextAttributes: () => ({ stencil: true }) };
    const adapter = new NodeDOMAdapter(null, 60, undefined, context);
    const canvas = adapter.createCanvas(32, 16);
    assert.equal(canvas.getContext("webgl"), context);
    assert.equal(canvas.getContext("webgl2"), context);
    assert.equal((canvas.getContext("webgl") as { getContextAttributes(): { stencil: boolean } })
        .getContextAttributes().stencil, true);
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
    const renderer = { resize() {}, getCurrentTexture() { return context as unknown as GPUTexture; } };
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
    const renderer = { resize() {}, getCurrentTexture() { return {} as GPUTexture; } };
    const canvas = new NodeGPUCanvas(renderer as never);
    let received: Event | undefined;
    const listener = (event: Event): void => { received = event; };

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
    adapter.install();
    let received: Event | undefined;
    const listener = (event: Event): void => { received = event; };
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
    assert.deepEqual(Array.from(context.getImageData(0, 0, 1, 1).data), [255, 0, 0, 255]);
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

test("NodeDOMAdapter loads a local image into a Canvas2D context", async () => {
    const adapter = new NodeDOMAdapter({} as never);
    const image = adapter.createImage();
    await new Promise<void>((resolve, reject) => {
        image.onload = (): void => {
            Promise.resolve().then(() => image.decode()).then(resolve, reject);
        };
        image.onerror = reject;
        image.src = fileURLToPath(new URL("../assets/test-texture.png", import.meta.url));
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
        image.src = new URL("../assets/bitmap-font/native-pixel.png", import.meta.url).href;
    });

    assert.equal(image.width, 192);
    assert.equal(image.height, 192);
});

test("NodeDOMAdapter fetches absolute paths and file URLs without HTTP", async () => {
    const adapter = new NodeDOMAdapter({} as never);
    const fontUrl = new URL(
        "../assets/bitmap-font/native-pixel.fnt",
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
