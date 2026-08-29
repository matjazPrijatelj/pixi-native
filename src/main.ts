import { GpuWindow } from "electrobun/main";
import { fileURLToPath } from "node:url";
import { Assets, Texture } from "pixi.js";
import { createPixiRenderer } from "./pixi-electrobun/createPixiRenderer.ts";
import { ElectrobunTextCanvas } from "./pixi-electrobun/ElectrobunTextCanvas.ts";
import { animateDemoScene, createGraphicsTest, createSpriteTest, createTextTest, createVideoTest } from "./demo/DemoScene.ts";

const win = new GpuWindow({ title: "PixiJS Native WGPU", frame: { width: 1280, height: 720 } });
const app = await createPixiRenderer(win);
const texturePath = fileURLToPath(new URL("../assets/test-texture.png", import.meta.url));
const loadedTexture = await Assets.load(texturePath);
const image = (loadedTexture as any).source?.resource;
const canvas = new ElectrobunTextCanvas(loadedTexture.width, loadedTexture.height);
const canvasContext = canvas.getContext("2d") as any;
if (!image || !canvasContext?.drawImage) throw new Error("Assets image cannot be rasterized into native Canvas2D");
canvasContext.drawImage(image, 0, 0, loadedTexture.width, loadedTexture.height);
const texture = Texture.from(canvas as any);
console.log({ asset: texturePath, loadedWidth: loadedTexture.width, loadedHeight: loadedTexture.height, spriteTextureWidth: texture.width, spriteTextureHeight: texture.height, sourceResource: image.constructor?.name });
const testFactories = [
    () => createGraphicsTest(),
    () => createSpriteTest(texture),
    () => createTextTest(),
    () => createVideoTest(fileURLToPath(new URL("../assets/Big_Buck_Bunny_720_10s_20MB.mp4", import.meta.url)))
] as const;
const testNames = ["graphics", "sprite", "text", "video"] as const;
let activeTestIndex = 0;
let scene = testFactories[activeTestIndex]();
app.stage.addChild(scene);
const selectTest = (index: number): void => {
    activeTestIndex = (index + testFactories.length) % testFactories.length;
    app.stage.removeChild(scene);
    scene = testFactories[activeTestIndex]();
    app.stage.addChild(scene);
    console.log({ activeTest: testNames[activeTestIndex] });
};
let loggedKeyEvent = false;
win.on("keyDown", (event: any) => {
    const data = event?.data ?? event;
    if (!loggedKeyEvent) {
        loggedKeyEvent = true;
        console.log({ keyEvent: data });
    }
    if (data?.isRepeat) return;
    const keyCode = Number(data?.keyCode);
    if (keyCode === 49 || keyCode === 0x31 || keyCode === 10) selectTest(0);
    else if (keyCode === 50 || keyCode === 0x32 || keyCode === 11) selectTest(1);
    else if (keyCode === 51 || keyCode === 0x33 || keyCode === 12) selectTest(2);
    else if (keyCode === 52 || keyCode === 0x34 || keyCode === 13) selectTest(3);
    else if (keyCode === 32 || keyCode === 0x20 || keyCode === 65) selectTest(activeTestIndex + 1);
});
console.log({ activeTest: testNames[activeTestIndex], controls: "1 Graphics  2 Sprite  3 Text  4 Video  Space Next" });

let frames = 0;
let total = 0;
let max = 0;
let previous = performance.now();
app.ticker.add((ticker) => {
    animateDemoScene(scene, ticker.deltaMS);
    const now = performance.now();
    const frameTime = now - previous;
    previous = now;
    frames += 1;
    total += frameTime;
    max = Math.max(max, frameTime);
});
setInterval(() => {
    console.log({ fps: frames / 5, averageFrameTimeMs: frames ? total / frames : 0, maxFrameTimeMs: max, renderer: "webgpu" });
    frames = 0;
    total = 0;
    max = 0;
}, 5000);

win.show();
