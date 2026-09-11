import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompositorFrameWaiter,
  createModalFrameController,
  syncNativeWindowSize,
} from "@pixi-native/core/runtime/ModalFrameController.js";

test("non-Windows renderers do not load the Win32 modal-frame addon", () => {
  const controller = createModalFrameController(
    new Uint8Array(),
    () => assert.fail("non-Windows modal frame callback must not run"),
    () => assert.fail("non-Windows modal state callback must not run"),
    "linux",
  );

  assert.doesNotThrow(() => controller.detach());
});

test("compositor frame waiter is Windows-only and forwards its timeout", async () => {
  const timeouts: Array<number | undefined> = [];
  const nativeWindow = {
    waitForCompositorFrame: async (timeoutMs?: number) => {
      timeouts.push(timeoutMs);
      return true;
    },
  };

  assert.equal(createCompositorFrameWaiter("linux", nativeWindow), undefined);
  const wait = createCompositorFrameWaiter("win32", nativeWindow);
  assert.equal(await wait?.(), true);
  assert.deepEqual(timeouts, [1_000]);
});

test("compositor frame waiter falls back when the native method is unavailable", () => {
  assert.equal(createCompositorFrameWaiter("win32", {}), undefined);
});

test("live resize synchronizes canvas, renderer, and layout in order", () => {
  const window = { pixelWidth: 1280, pixelHeight: 720 };
  const order: string[] = [];
  const canvas = {
    width: 800,
    height: 600,
    resize(width: number, height: number): void {
      order.push(`canvas:${width}x${height}`);
      this.width = width;
      this.height = height;
    },
  };

  assert.equal(
    syncNativeWindowSize(
      window,
      canvas,
      (width, height) => order.push(`renderer:${width}x${height}`),
      () => order.push("layout"),
    ),
    true,
  );
  assert.deepEqual(order, ["canvas:1280x720", "renderer:1280x720", "layout"]);

  order.length = 0;
  assert.equal(
    syncNativeWindowSize(window, canvas, () => order.push("renderer")),
    false,
  );
  assert.deepEqual(order, []);
});
