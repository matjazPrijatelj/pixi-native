import test from "node:test";
import assert from "node:assert/strict";
import { Graphics } from "pixi.js";
import {
  animateDemoScene,
  createGraphicsTest,
} from "../src/demo/v8/DemoScene.ts";

test("Graphics test creates and animates nine primitives", () => {
  const scene = createGraphicsTest();
  const graphics = scene.children.filter(
    (child): child is Graphics => child instanceof Graphics,
  );
  const initialRotations = graphics.map((graphic) => graphic.rotation);

  animateDemoScene(scene, 16.5, 1234);

  assert.equal(graphics.length, 9);
  assert.ok(
    graphics.every(
      (graphic, index) => graphic.rotation !== initialRotations[index],
    ),
  );
  scene.destroy({ children: true });
});
