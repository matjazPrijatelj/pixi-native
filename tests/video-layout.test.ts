import test from "node:test";
import assert from "node:assert/strict";
import { fitVideoRect } from "../src/demo/v8/videoLayout.ts";

test("fitVideoRect fits 1080p video into a 16:9 window", () => {
    const rect = fitVideoRect(1920, 1080, 1280, 720);
    assert.ok(Math.abs(rect.x - 81.7777777778) < 0.000001);
    assert.equal(rect.y, 92);
    assert.ok(Math.abs(rect.width - 1116.4444444444) < 0.000001);
    assert.equal(rect.height, 628);
});

test("fitVideoRect preserves aspect ratio in a portrait window", () => {
    const rect = fitVideoRect(1920, 1080, 600, 900);
    assert.ok(Math.abs(rect.width / rect.height - 16 / 9) < 0.000001);
    assert.equal(rect.x, 0);
    assert.equal(rect.y, 327.25);
    assert.equal(rect.width, 600);
});

test("fitVideoRect rejects invalid source dimensions", () => {
    assert.throws(() => fitVideoRect(0, 1080, 1280, 720), /dimensions/);
});
