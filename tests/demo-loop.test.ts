import assert from "node:assert/strict";
import test from "node:test";
import { createDemoLoop } from "../src/demo/DemoLoop.ts";

test("automatic scene loop starts enabled and Space toggle callbacks are observable", () => {
  const states: boolean[] = [];
  const loop = createDemoLoop(() => undefined, (enabled) => states.push(enabled));
  try {
    assert.equal(loop.enabled, true);
    assert.deepEqual(states, [true]);
    loop.toggle();
    assert.equal(loop.enabled, false);
    assert.deepEqual(states, [true, false]);
    loop.toggle();
    assert.equal(loop.enabled, true);
    assert.deepEqual(states, [true, false, true]);
  } finally {
    loop.destroy();
  }
});
