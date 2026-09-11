import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { normalizeSdlKeyName } = require(
  "../native/window/src/key-mapping.js",
) as { normalizeSdlKeyName(name: string): string };

test("SDL3 key names retain the previous native window contract", () => {
  assert.equal(normalizeSdlKeyName("M"), "m");
  assert.equal(normalizeSdlKeyName("Up"), "up");
  assert.equal(normalizeSdlKeyName("Down"), "down");
  assert.equal(normalizeSdlKeyName("Left"), "left");
  assert.equal(normalizeSdlKeyName("Right"), "right");
  assert.equal(normalizeSdlKeyName("Space"), "space");
  assert.equal(normalizeSdlKeyName("Left Ctrl"), "ctrl");
  assert.equal(normalizeSdlKeyName("F12"), "f12");
});
