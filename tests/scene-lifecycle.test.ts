import test from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite, Texture } from "pixi.js";
import {
    disposeDemoScene,
    type DisposableDemoScene,
} from "../src/demo/sceneLifecycle.ts";
import {
    NativeVideo,
    NativeVideoSprite,
} from "../src/pixi-node/video/index.ts";

test("disposing a demo scene releases children and calls dispose once", () => {
    const stage = new Container();
    const scene = new Container() as DisposableDemoScene;
    const child = new Container();
    let disposeCalls = 0;
    scene.dispose = () => disposeCalls++;
    scene.addChild(child);
    stage.addChild(scene);

    disposeDemoScene(scene);
    disposeDemoScene(scene);

    assert.equal(disposeCalls, 1);
    assert.equal(scene.destroyed, true);
    assert.equal(child.destroyed, true);
    assert.equal(stage.children.length, 0);
});

test("disposing a scene preserves textures owned outside the scene", () => {
    const sharedTexture = new Texture({
        source: Texture.WHITE.source,
    });
    const scene = new Container();
    const sprite = new Sprite(sharedTexture);
    scene.addChild(sprite);

    disposeDemoScene(scene);

    assert.equal(sprite.destroyed, true);
    assert.equal(sharedTexture.destroyed, false);
    sharedTexture.destroy(false);
});

test("NativeVideoSprite destroys its owned planes and geometry buffers", () => {
    const video = new NativeVideo("unused.mp4", {
        width: 2,
        height: 2,
        fps: 24,
    });
    const sprite = new NativeVideoSprite(video);
    const owned = sprite as unknown as {
        ySource: { destroyed: boolean };
        uvSource: { destroyed: boolean };
        ownedGeometry: { buffers: Array<{ destroyed: boolean }> };
    };
    const buffers = [...owned.ownedGeometry.buffers];

    sprite.destroy();
    video.destroy();

    assert.equal(owned.ySource.destroyed, true);
    assert.equal(owned.uvSource.destroyed, true);
    assert.equal(buffers.every((buffer) => buffer.destroyed), true);
});
