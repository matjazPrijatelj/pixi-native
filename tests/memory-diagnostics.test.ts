import assert from "node:assert/strict";
import test from "node:test";
import {
  countCacheEntries,
  countSceneObjects,
} from "../src/demo/memoryDiagnostics.ts";

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

test("memory diagnostics counts Pixi cache entries across cache shapes", () => {
  assert.equal(countCacheEntries({ _cacheMap: new Map([["a", {}]]) }), 1);
  assert.equal(countCacheEntries({ _cache: { a: {}, b: {} } }), 2);
  assert.equal(countCacheEntries(undefined), 0);
});
