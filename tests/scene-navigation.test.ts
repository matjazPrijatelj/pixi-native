import test from "node:test";
import assert from "node:assert/strict";
import {
  getSceneIndexForKey,
  getSpriteCountDeltaForKey,
  getVideoIndexForKey,
  isReloadShortcut,
} from "../src/demo/v8/sceneNavigation.ts";

test("Ctrl+R is a case-insensitive non-repeating reload shortcut", () => {
  assert.equal(isReloadShortcut("r", true, false), true);
  assert.equal(isReloadShortcut("R", false, true), true);
  assert.equal(isReloadShortcut("r", false, false), false);
  assert.equal(isReloadShortcut("r", true, true, true), false);
});

test("number keys select the matching scene", () => {
  assert.equal(getSceneIndexForKey("1", 0, 6), 0);
  assert.equal(getSceneIndexForKey("2", 0, 6), 1);
  assert.equal(getSceneIndexForKey("3", 0, 6), 2);
  assert.equal(getSceneIndexForKey("4", 0, 6), 3);
  assert.equal(getSceneIndexForKey("5", 0, 6), 4);
  assert.equal(getSceneIndexForKey("6", 0, 6), 5);
  assert.equal(getSceneIndexForKey("7", 0, 7), 6);
  assert.equal(getSceneIndexForKey("8", 0, 8), 7);
  assert.equal(getSceneIndexForKey("9", 0, 9), 8);
  assert.equal(getSceneIndexForKey("9", 0, 6), 5);
});

test("arrow keys navigate with wraparound", () => {
  assert.equal(getSceneIndexForKey("left", 0, 4), 3);
  assert.equal(getSceneIndexForKey("ArrowLeft", 0, 4), 3);
  assert.equal(getSceneIndexForKey("right", 3, 4), 0);
  assert.equal(getSceneIndexForKey("ArrowRight", 3, 4), 0);
  assert.equal(getSceneIndexForKey("right", 1, 4), 2);
});

test("unknown and repeated key presses do not change the scene", () => {
  assert.equal(getSceneIndexForKey("x", 1, 4), null);
  assert.equal(getSceneIndexForKey("right", 1, 4, true), null);
  assert.equal(getSceneIndexForKey(null, 1, 4), null);
});

test("number keys beyond the available scenes are ignored", () => {
  assert.equal(getSceneIndexForKey("4", 0, 3), null);
  assert.equal(getSceneIndexForKey("5", 0, 4), null);
  assert.equal(getSceneIndexForKey("6", 0, 5), null);
});

test("video navigation cycles with up and down", () => {
  assert.equal(getVideoIndexForKey("up", 0, 5), 4);
  assert.equal(getVideoIndexForKey("ArrowUp", 0, 5), 4);
  assert.equal(getVideoIndexForKey("down", 4, 5), 0);
  assert.equal(getVideoIndexForKey("ArrowDown", 4, 5), 0);
  assert.equal(getVideoIndexForKey("down", 1, 5), 2);
  assert.equal(getVideoIndexForKey("left", 1, 5), null);
  assert.equal(getVideoIndexForKey("up", 1, 5, true), null);
});

test("Sprite population controls add and remove batches of ten", () => {
  assert.equal(getSpriteCountDeltaForKey("up"), 10);
  assert.equal(getSpriteCountDeltaForKey("ArrowUp"), 10);
  assert.equal(getSpriteCountDeltaForKey("down"), -10);
  assert.equal(getSpriteCountDeltaForKey("ArrowDown"), -10);
  assert.equal(getSpriteCountDeltaForKey("left"), null);
  assert.equal(getSpriteCountDeltaForKey("up", true), null);
});
