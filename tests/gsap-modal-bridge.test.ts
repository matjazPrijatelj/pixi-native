import test from "node:test";
import assert from "node:assert/strict";
import { installGsapModalBridge } from "../src/demo/gsapModalBridge.ts";

test("GSAP modal bridge ticks and removes its native listener", () => {
  let modalListener: (() => void) | undefined;
  let removeCount = 0;
  let tickCount = 0;
  const destroyListeners: Array<() => void | Promise<void>> = [];

  installGsapModalBridge(
    {
      addModalFrameListener: (listener) => {
        modalListener = listener;
        return () => {
          modalListener = undefined;
          removeCount++;
        };
      },
    },
    { tick: () => tickCount++ },
    (listener) => {
      destroyListeners.push(listener);
      return () => undefined;
    },
  );

  modalListener?.();
  assert.equal(tickCount, 1);
  assert.equal(destroyListeners.length, 1);

  destroyListeners[0]();
  assert.equal(modalListener, undefined);
  assert.equal(removeCount, 1);
});

test("GSAP modal bridge is a no-op without native modal frames", () => {
  let destroyListenerCount = 0;

  installGsapModalBridge(
    {},
    { tick: () => assert.fail("unexpected GSAP tick") },
    () => {
      destroyListenerCount++;
      return () => undefined;
    },
  );

  assert.equal(destroyListenerCount, 0);
});
