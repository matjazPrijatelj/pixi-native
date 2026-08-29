import { GpuWindow } from "electrobun/main";
import { createPixiRenderer } from "./pixi-electrobun/createPixiRenderer.ts";
import { animateDemoScene, createDemoScene } from "./demo/DemoScene.ts";

const win = new GpuWindow({ title: "PixiJS Native WGPU", frame: { width: 1280, height: 720 } });
const app = await createPixiRenderer(win);
const scene = createDemoScene();
app.stage.addChild(scene);

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
