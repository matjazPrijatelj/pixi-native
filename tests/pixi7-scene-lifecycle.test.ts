import test from "node:test";
import assert from "node:assert/strict";
import { Container, settings, Sprite, Text, Texture, utils } from "pixi.js-v7";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import { disposeDemoScene } from "../src/demo/v7/sceneLifecycle.ts";
import {
  createTextTest,
  OTF_DEMO_FONT_FAMILY,
} from "../src/demo/v7/scenes/TextTest.ts";

test("PixiJS 7 scene disposal releases Text textures but preserves shared Sprite textures", () => {
  new NodeDOMAdapter({} as never).installPixi7(settings);
  const sharedTexture = Texture.WHITE;
  const textureCacheKeys = Object.keys(utils.TextureCache).sort();
  const baseTextureCacheKeys = Object.keys(utils.BaseTextureCache).sort();

  for (let iteration = 0; iteration < 25; iteration++) {
    const scene = new Container();
    const label = new Text(`scene lifecycle ${iteration}`, {
      fontFamily: "Arial",
      fontSize: 26,
    });
    const textTexture = label.texture;
    const textBaseTexture = textTexture.baseTexture;
    const sprite = new Sprite(sharedTexture);

    label.updateText(false);
    scene.addChild(label, sprite);
    disposeDemoScene(scene);

    assert.equal(scene.destroyed, true);
    assert.equal(label.destroyed, true);
    assert.equal(textTexture.destroyed, true);
    assert.equal(textBaseTexture.destroyed, true);
    assert.equal(sprite.destroyed, true);
  }

  assert.deepEqual(Object.keys(utils.TextureCache).sort(), textureCacheKeys);
  assert.deepEqual(
    Object.keys(utils.BaseTextureCache).sort(),
    baseTextureCacheKeys,
  );
  assert.equal(sharedTexture.destroyed, false);
});

test("PixiJS 7 Text scene visibly uses the loaded OTF family", () => {
  new NodeDOMAdapter({} as never).installPixi7(settings);
  const scene = createTextTest();
  const labels = scene.children.filter((child): child is Text => child instanceof Text);
  const otfLabel = labels.find(
    (label) => label.style.fontFamily === OTF_DEMO_FONT_FAMILY,
  );

  assert.ok(otfLabel);
  assert.match(otfLabel.text, /OTF Source Sans 3/);
  assert.match(otfLabel.text, /ČŠŽ/);
  disposeDemoScene(scene);
});
