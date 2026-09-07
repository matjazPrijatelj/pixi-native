import test from "node:test";
import assert from "node:assert/strict";
import {
  createCompositorFrameWaiter,
  createModalFrameController,
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
