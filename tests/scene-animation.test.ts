import test from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite } from "pixi.js";
import { animateDemoScene } from "../src/demo/DemoScene.ts";

test("animateDemoScene tolerates scenes with fewer than three children", () => {
    assert.doesNotThrow(() => animateDemoScene(new Container(), 16));
    const errorScene = new Container();
    errorScene.addChild(new Container());
    errorScene.addChild(new Container());
    assert.doesNotThrow(() => animateDemoScene(errorScene, 16));
});

test("animateDemoScene still animates a sprite at the expected slot", () => {
    const scene = new Container();
    scene.addChild(new Container());
    scene.addChild(new Container());
    const sprite = new Sprite();
    scene.addChild(sprite);
    animateDemoScene(scene, 16, 0);
    assert.equal(sprite.x, 640);
    assert.equal(sprite.y, 440);
});
