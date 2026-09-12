import assert from "node:assert/strict";
import test from "node:test";
import { countSceneObjects } from "../src/demo/memoryDiagnostics.ts";

class Sprite {
  readonly texture = {};
  readonly children = [];
}

class AnimatedSprite extends Sprite {
  readonly textures = [{}, {}];
}

class Text {
  readonly children = [];
}

class BitmapText {
  readonly children = [];
}

class Graphics {
  readonly children = [];
}

class Container {
  readonly children: readonly unknown[];

  constructor(children: readonly unknown[]) {
    this.children = children;
  }
}

test("memory diagnostics inventories scene objects and unique textures", () => {
  const sprite = new Sprite();
  const animated = new AnimatedSprite();
  const roots = [
    new Container([sprite, animated, new Text(), new BitmapText(), new Graphics()]),
  ];

  assert.deepEqual(countSceneObjects(roots), {
    Container: 1,
    Sprite: 1,
    AnimatedSprite: 1,
    Text: 1,
    BitmapText: 1,
    Graphics: 1,
    uniqueTextures: 4,
  });
});
