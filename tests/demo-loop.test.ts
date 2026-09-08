import test from "node:test";
import assert from "node:assert/strict";
import {
  createDemoLoop,
  getNextLoopSceneIndex,
  isLoopDemoShortcut,
} from "../src/demo/DemoLoop.ts";

test("plus toggles the demo loop only on the initial key press", () => {
  assert.equal(isLoopDemoShortcut("+"), true);
  assert.equal(isLoopDemoShortcut("+", true), false);
  assert.equal(isLoopDemoShortcut("="), false);
  assert.equal(isLoopDemoShortcut(null), false);
});

test("the demo loop cycles only the four core scenes", () => {
  assert.equal(getNextLoopSceneIndex(0), 1);
  assert.equal(getNextLoopSceneIndex(1), 2);
  assert.equal(getNextLoopSceneIndex(2), 3);
  assert.equal(getNextLoopSceneIndex(3), 0);
  assert.equal(getNextLoopSceneIndex(8), 0);
});

test("the demo loop is disabled by default and can be toggled", () => {
  const loop = createDemoLoop(
    () => undefined,
    () => 0,
  );

  assert.equal(loop.enabled, false);
  loop.toggle();
  assert.equal(loop.enabled, true);
  loop.toggle();
  assert.equal(loop.enabled, false);

  loop.destroy();
});
