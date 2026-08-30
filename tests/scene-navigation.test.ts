import test from "node:test";
import assert from "node:assert/strict";
import { getSceneIndexForKey } from "../src/demo/sceneNavigation.ts";

test("number keys select the matching scene", () => {
    assert.equal(getSceneIndexForKey("1", 0, 4), 0);
    assert.equal(getSceneIndexForKey("2", 0, 4), 1);
    assert.equal(getSceneIndexForKey("3", 0, 4), 2);
    assert.equal(getSceneIndexForKey("4", 0, 4), 3);
});

test("arrow keys navigate with wraparound", () => {
    assert.equal(getSceneIndexForKey("left", 0, 4), 3);
    assert.equal(getSceneIndexForKey("right", 3, 4), 0);
    assert.equal(getSceneIndexForKey("right", 1, 4), 2);
});

test("unknown and repeated key presses do not change the scene", () => {
    assert.equal(getSceneIndexForKey("x", 1, 4), null);
    assert.equal(getSceneIndexForKey("right", 1, 4, true), null);
    assert.equal(getSceneIndexForKey(null, 1, 4), null);
});

test("number keys beyond the available scenes are ignored", () => {
    assert.equal(getSceneIndexForKey("4", 0, 3), null);
});
