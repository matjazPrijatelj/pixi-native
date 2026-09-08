import test from "node:test";
import assert from "node:assert/strict";
import { Container, Graphics } from "pixi.js";
import {
  animateDemoScene,
  createGraphicsTest,
} from "../src/demo/v8/DemoScene.ts";

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
