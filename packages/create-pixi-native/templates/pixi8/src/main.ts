import { Assets, Graphics, Sprite, Text, createApp } from "@matjazprijatelj/pixi-native";
import { createModuleFileAccess } from "@matjazprijatelj/pixi-native/pixi8/files";

const runtime = await createApp({
    backend: "{{BACKEND}}",
    width: 960,
    height: 540,
    title: "{{PROJECT_NAME}}",
});
const files = createModuleFileAccess(import.meta.url);
const texturePath = files.resolvePath("../assets/pixi-native.png");
const texture = await Assets.load(texturePath);

const panel = new Graphics().roundRect(-190, -125, 380, 250, 24).fill(0x172033);
const sprite = new Sprite(texture);
sprite.anchor.set(0.5);
sprite.width = 128;
sprite.height = 128;
sprite.tint = 0x4f8cff;
const label = new Text({
    text: "Pixi Native 8 · {{BACKEND}}",
    style: { fill: 0xffffff, fontFamily: "Arial", fontSize: 28 },
});
label.anchor.set(0.5);
runtime.app.stage.addChild(panel, sprite, label);

const layout = (): void => {
    const centerX = runtime.native.canvas.width / 2;
    const centerY = runtime.native.canvas.height / 2;
    panel.position.set(centerX, centerY);
    sprite.position.set(centerX, centerY - 28);
    label.position.set(centerX, centerY + 82);
};
layout();
runtime.native.window.on("resize", layout);
runtime.app.ticker.add((ticker) => {
    sprite.rotation += ticker.deltaMS * 0.0008;
});
runtime.addDestroyListener(() => Assets.unload(texturePath));
