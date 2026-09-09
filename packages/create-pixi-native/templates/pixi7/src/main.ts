import {
  Assets,
  Graphics,
  Sprite,
  Text,
  createApp,
} from "@matjash/pixi-native/pixi7";
import { createModuleFileAccess } from "@matjash/pixi-native/pixi7/files";
import { startBackgroundAnimation } from "./backgroundAnimation.ts";

const runtime = await createApp({
  width: 960,
  height: 540,
  title: "{{PROJECT_NAME}}",
});
const files = createModuleFileAccess(import.meta.url);
const backgroundTexturePath = files.resolvePath("../assets/pixi-hero.png");
const backgroundTexture = await Assets.load(backgroundTexturePath);

const panel = new Graphics()
  .beginFill(0x172033)
  .drawRoundedRect(-190, -125, 380, 250, 24)
  .endFill();
panel.alpha = 0.35;
const background = new Sprite(backgroundTexture);
background.anchor.set(0.5);
background.scale.set(0.5);
const label = new Text("Pixi Native 7 · webgl", {
  fill: 0xffffff,
  fontFamily: "Arial",
  fontSize: 28,
});
label.anchor.set(0.5);
label.y -= 50;
runtime.app.stage.addChild(background, panel, label);

const layout = (): void => {
  const centerX = runtime.native.canvas.width / 2;
  const centerY = runtime.native.canvas.height / 2;
  background.position.set(centerX, centerY);
  panel.position.set(centerX, centerY);
  label.position.set(centerX, centerY);
};
layout();
runtime.native.window.on("resize", layout);
await startBackgroundAnimation(runtime, background);
runtime.addDestroyListener(async () => {
  await Assets.unload(backgroundTexturePath);
});
