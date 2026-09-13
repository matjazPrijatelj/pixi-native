import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoLoop,
  getAutotoggleIntervalMs,
  isAutoToggleShortcut,
  shouldSkipAutoScene,
} from "../src/demo/DemoLoop.ts";

test("autotoggle interval reads seconds from environment with 15s fallback", () => {
  assert.equal(getAutotoggleIntervalMs({ AUTOTOGGLE_INTERVAL: "2" }), 2000);
  assert.equal(getAutotoggleIntervalMs({ AUTOTOGGLE_INTERVAL: "0" }), 15000);
  assert.equal(getAutotoggleIntervalMs({ AUTOTOGGLE_INTERVAL: "bad" }), 15000);
});

test("autotoggle skips only RTP video", () => {
  assert.equal(shouldSkipAutoScene("rtp-video"), true);
  assert.equal(shouldSkipAutoScene("video"), false);
  assert.equal(shouldSkipAutoScene("audio"), false);
});

test("space key names toggle autotoggle", () => {
  for (const key of [" ", "Space", "space", "Spacebar", "SPACEBAR"]) {
    assert.equal(isAutoToggleShortcut(key), true);
  }
  assert.equal(isAutoToggleShortcut(" ", true), false);
  assert.equal(isAutoToggleShortcut("Unidentified", false, "Space"), true);
  assert.equal(isAutoToggleShortcut("Enter"), false);
});

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
