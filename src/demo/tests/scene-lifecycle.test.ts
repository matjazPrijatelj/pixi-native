import test from "node:test";
import assert from "node:assert/strict";
import { Container, Sprite, Texture } from "pixi.js";
import {
    disposeDemoScene,
    type DisposableDemoScene,
} from "../v8/sceneLifecycle.ts";
import { NativeVideo } from "../../pixi-native/video/index.ts";
import { NativeVideoSprite } from "../../pixi-native/video/NativeVideoSprite.ts";
import { uploadNv12FrameWebGl } from "../../pixi-native/video/NativeVideoSprite.ts";

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

test("disposing a render-group scene returns its instruction buffers for reuse", () => {
    const firstScene = new Container();
    firstScene.enableRenderGroup();
    const pooledRenderGroup = firstScene.renderGroup;
    const instructionSetUid = pooledRenderGroup?.instructionSet.uid;

    assert.ok(pooledRenderGroup);
    assert.notEqual(instructionSetUid, undefined);

    disposeDemoScene(firstScene);

    assert.equal(firstScene.renderGroup, null);

    const secondScene = new Container();
    secondScene.enableRenderGroup();

    assert.equal(secondScene.renderGroup, pooledRenderGroup);
    assert.equal(
        secondScene.renderGroup?.instructionSet.uid,
        instructionSetUid,
    );

    disposeDemoScene(secondScene);
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
    assert.equal(
        buffers.every((buffer) => buffer.destroyed),
        true,
    );
});

test("NativeVideoSprite observes source resets without being recreated", () => {
    const video = new NativeVideo(
        "first.mp4",
        {
            width: 2,
            height: 2,
            audio: false,
        },
        {
            createDecoder: () => {
                throw new Error("decoder must not start while paused");
            },
        },
    );
    const sprite = new NativeVideoSprite(video);
    const state = sprite as unknown as { needsClear: boolean };

    assert.equal(state.needsClear, false);
    video.src = "second.mp4";
    assert.equal(state.needsClear, true);

    sprite.destroy();
    video.destroy();
});

test("NativeVideoSprite renders packed alpha at the color-region width", () => {
    const video = new NativeVideo("unused-alpha.mp4", {
        width: 1920,
        height: 768,
        fps: 30,
        audio: false,
    });
    const sprite = new NativeVideoSprite(video, { alphaMaskScale: 0.5 });
    const owned = sprite as unknown as {
        ySource: { alphaMode: string };
        ownedGeometry: { positions: Float32Array };
    };

    assert.equal(sprite.width, 1280);
    assert.deepEqual(
        Array.from(owned.ownedGeometry.positions),
        [0, 0, 1280, 0, 1280, 768, 0, 768],
    );
    assert.equal(owned.ySource.alphaMode, "premultiply-alpha-on-upload");

    sprite.destroy();
    video.destroy();
});

test("WebGL NV12 upload uses separate texture units and restores unpack alignment", () => {
    const calls: Array<[string, ...unknown[]]> = [];
    const ySource = {} as never;
    const uvSource = {} as never;
    const yTexture = { target: 3553, texture: "y" };
    const uvTexture = { target: 3553, texture: "uv" };
    const renderer = {
        name: "webgl",
        gl: {
            TEXTURE0: 33984,
            TEXTURE_2D: 3553,
            RED: 6403,
            RG: 33319,
            UNSIGNED_BYTE: 5121,
            UNPACK_ALIGNMENT: 3317,
            activeTexture: (value: number) =>
                calls.push(["activeTexture", value]),
            bindTexture: (target: number, texture: unknown) =>
                calls.push(["bindTexture", target, texture]),
            pixelStorei: (parameter: number, value: number) =>
                calls.push(["pixelStorei", parameter, value]),
            texSubImage2D: (...args: unknown[]) =>
                calls.push(["texSubImage2D", ...args]),
        },
        texture: {
            bindSource: (source: never, location?: number) =>
                calls.push([
                    "bindSource",
                    source === ySource ? "y" : "uv",
                    location ?? 0,
                ]),
            getGlSource: (source: never) =>
                source === ySource ? yTexture : uvTexture,
        },
    };
    const frame = {
        width: 4,
        height: 2,
        timestampUs: 0,
        y: new Uint8Array(8),
        uv: new Uint8Array(4),
        yStride: 4,
        uvStride: 4,
        pixelFormat: "nv12" as const,
    };

    uploadNv12FrameWebGl(renderer, ySource, uvSource, frame);

    assert.deepEqual(
        calls.filter(([name]) => name === "bindSource"),
        [
            ["bindSource", "y", 0],
            ["bindSource", "uv", 1],
        ],
    );
    assert.deepEqual(
        calls.filter(([name]) => name === "pixelStorei"),
        [
            ["pixelStorei", 3317, 1],
            ["pixelStorei", 3317, 4],
        ],
    );
    assert.deepEqual(calls.at(-1), ["activeTexture", 33984]);
    assert.equal(calls.filter(([name]) => name === "texSubImage2D").length, 2);
});
