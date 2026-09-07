import test from "node:test";
import assert from "node:assert/strict";
import { getPackedAlphaVideoLayout } from "../src/pixi-native/video/packedAlpha.ts";

test("packed alpha layout resolves the reference 1280 plus 640 frame", () => {
    assert.deepEqual(getPackedAlphaVideoLayout(1920, 768, 0.5), {
        frameWidth: 1920,
        frameHeight: 768,
        colorWidth: 1280,
        alphaWidth: 640,
        colorFraction: 2 / 3,
        yTexelX: 1 / 1920,
        yTexelY: 1 / 768,
        uvTexelX: 2 / 1920,
        uvTexelY: 2 / 768,
    });
});

test("packed alpha layout supports half-and-half frames", () => {
    const layout = getPackedAlphaVideoLayout(1280, 720, 1);
    assert.equal(layout.colorWidth, 640);
    assert.equal(layout.alphaWidth, 640);
    assert.equal(layout.colorFraction, 0.5);
});

test("packed alpha layout rejects invalid ratios and chroma-unaligned splits", () => {
    assert.throws(
        () => getPackedAlphaVideoLayout(1920, 768, 0),
        /positive and finite/,
    );
    assert.throws(
        () => getPackedAlphaVideoLayout(1920, 768, Number.NaN),
        /positive and finite/,
    );
    assert.throws(
        () => getPackedAlphaVideoLayout(1920, 768, 0.3),
        /whole pixel widths/,
    );
    assert.throws(
        () => getPackedAlphaVideoLayout(10, 2, 1),
        /positive even numbers/,
    );
    assert.throws(
        () => getPackedAlphaVideoLayout(1920, 767, 0.5),
        /frame dimensions/,
    );
});
