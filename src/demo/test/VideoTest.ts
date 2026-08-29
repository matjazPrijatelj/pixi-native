import { Container, Sprite, Text, Texture } from "pixi.js";
import { ImageData } from "skia-canvas";
import { ElectrobunTextCanvas } from "../../pixi-electrobun/ElectrobunTextCanvas.ts";
import { NativeVideoDecoder } from "../../video/NativeVideoDecoder.ts";
const WIDTH = 1280; const HEIGHT = 720;
export function createVideoTest(source: string): Container {
    const scene = new Container();
    scene.addChild(new Text({ text: "VIDEO TEST  [4]", style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }));
    const canvas = new ElectrobunTextCanvas(WIDTH, HEIGHT); const context = canvas.getContext("2d") as any;
    const texture = Texture.from(canvas as any); const sprite = new Sprite(texture); sprite.position.set(0, 36); sprite.width = WIDTH; sprite.height = HEIGHT - 36; scene.addChild(sprite);
    const status = new Text({ text: "Loading video…", style: { fontFamily: "Arial", fontSize: 22, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }); status.position.set(24, 60); scene.addChild(status);
    const decoder = new NativeVideoDecoder({ width: WIDTH, height: HEIGHT, fps: 30 });
    void decoder.open(source, (frame) => { const imageData = new ImageData(new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength) as any, frame.width, frame.height); context.putImageData(imageData, 0, 0); (texture.source as any).update(); status.text = `VIDEO TEST  [4]  ${Math.round(frame.timestampUs / 1000)} ms`; }).catch((error: unknown) => { status.text = `Video error: ${error instanceof Error ? error.message : String(error)}`; console.error("[VideoTest] decoder failed", error); });
    scene.on("removed", () => decoder.close()); return scene;
}
