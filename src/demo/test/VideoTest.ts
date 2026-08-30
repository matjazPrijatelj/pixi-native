import { Container, Sprite, Text, Texture } from "pixi.js";
import { ImageData } from "skia-canvas";
import { NodeTextCanvas } from "../../pixi-node/NodeTextCanvas.ts";
import { NativeVideoDecoder, VideoFpsMeter } from "../../video/NativeVideoDecoder.ts";
import { fitVideoRect } from "../videoLayout.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const VIDEO_TOP_INSET = 92;

export function createVideoTest(source: string, viewport: { width: number; height: number }): Container {
    const scene = new Container();
    scene.addChild(new Text({ text: "VIDEO TEST  [4]  FFmpeg VA-API", style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }));
    const canvas = new NodeTextCanvas(WIDTH, HEIGHT);
    const context = canvas.getContext("2d") as { putImageData(image: ImageData, x: number, y: number): void };
    const texture = Texture.from({ resource: canvas, width: WIDTH, height: HEIGHT } as never);
    const sprite = new Sprite(texture);
    const videoScene = scene as Container & { resize(width: number, height: number): void };
    videoScene.resize = (width, height) => {
        const rect = fitVideoRect(WIDTH, HEIGHT, width, height, VIDEO_TOP_INSET);
        sprite.position.set(rect.x, rect.y);
        sprite.width = rect.width;
        sprite.height = rect.height;
    };
    scene.addChild(sprite);
    videoScene.resize(viewport.width, viewport.height);
    const decoder = new NativeVideoDecoder({ width: WIDTH, height: HEIGHT, fps: FPS });
    const fpsMeter = new VideoFpsMeter();
    let measuredFps: number | null = null;
    const formatStatus = (timestampUs: number, loading = false): string => {
        const fps = measuredFps === null ? "--" : measuredFps.toFixed(1);
        const state = loading ? "loading…" : String(Math.round(timestampUs / 1000)) + " ms";
        return "Decoder: " + decoder.info.decoderType + " / " + decoder.info.hardwareBackend + " | FPS: " + fps + " | target: " + decoder.info.targetFps + " | " + state;
    };
    const status = new Text({ text: formatStatus(0, true), style: { fontFamily: "Arial", fontSize: 22, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    status.position.set(24, 60); scene.addChild(status);
    void decoder.open(source, (frame) => {
        measuredFps = fpsMeter.observe(performance.now()) ?? measuredFps;
        context.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
        (texture.source as { update(): void }).update();
        status.text = formatStatus(frame.timestampUs);
    }, (error) => {
        status.text = `Video error: ${error.message}`;
        console.error("[VideoTest] FFmpeg VA-API decoder failed", error);
    }).catch((error: unknown) => { status.text = `Video error: ${error instanceof Error ? error.message : String(error)}`; });
    scene.on("removed", () => decoder.close());
    return videoScene;
}
