import test from "node:test";
import assert from "node:assert/strict";
import { Container } from "pixi.js";
import { animateDemoScene } from "../src/demo/DemoScene.ts";

test("animateDemoScene tolerates scenes with fewer than three children", () => {
    assert.doesNotThrow(() => animateDemoScene(new Container(), 16));
    const errorScene = new Container();
    errorScene.addChild(new Container());
    errorScene.addChild(new Container());
    assert.doesNotThrow(() => animateDemoScene(errorScene, 16));
});

test("animateDemoScene forwards timing to a scene update hook", () => {
    const scene = new Container() as Container & {
        update(deltaMS: number, now: number): void;
    };
    let timing: [number, number] | undefined;
    scene.update = (deltaMS, now) => {
        timing = [deltaMS, now];
    };

    animateDemoScene(scene, 16.5, 1234);

    assert.deepEqual(timing, [16.5, 1234]);
});
