import { Container, Sprite, Text, Texture, type TextureSource } from "pixi.js";
import { NativeVideoDecoder, VideoFpsMeter, type VideoFrameData } from "../../video/NativeVideoDecoder.ts";
import { fitVideoRect } from "../videoLayout.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const VIDEO_TOP_INSET = 92;

export function createVideoTest(source: string, viewport: { width: number; height: number }, uploadRgbaTexture: (texture: TextureSource, data: Uint8Array, width: number, height: number) => void, label = source): Container {
    const scene = new Container();
    const fileName = label.split(/[\\/]/).pop() ?? label;
    scene.addChild(new Text({ text: `VIDEO TEST  [4]  ${fileName}  [UP/DOWN: change video]`, style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }));
    const initialFrame = new Uint8Array(WIDTH * HEIGHT * 4);
    const texture = Texture.from({ resource: initialFrame, width: WIDTH, height: HEIGHT, format: "rgba8unorm" } as never);
    const sprite = new Sprite(texture);
    let pendingFrame: VideoFrameData | undefined;
    const videoScene = scene as Container & { resize(width: number, height: number): void; update(): void };
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
    const uploadFpsMeter = new VideoFpsMeter();
    let measuredFps: number | null = null;
    let uploadFps: number | null = null;
    let receivedFrames = 0;
    let uploadedFrames = 0;
    let pendingTimestampUs = 0;
    const formatStatus = (timestampUs: number, loading = false): string => {
        const decodedFps = measuredFps === null ? "--" : measuredFps.toFixed(1);
        const upload = uploadFps === null ? "--" : uploadFps.toFixed(1);
        const state = loading ? "loading…" : String(Math.round(timestampUs / 1000)) + " ms";
        return "Decoder: " + decoder.info.decoderType + " / " + decoder.getBackend() + " | Decoded FPS: " + decodedFps + " | UP: " + upload + " | frames: " + receivedFrames + "/" + uploadedFrames + " | " + state;
    };
    const status = new Text({ text: formatStatus(0, true), style: { fontFamily: "Arial", fontSize: 22, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
    status.position.set(24, 60); scene.addChild(status);
    videoScene.update = () => {
        decoder.pollLatest();
        if (!pendingFrame) return;
        uploadRgbaTexture(texture.source, pendingFrame.data, pendingFrame.width, pendingFrame.height);
        uploadedFrames++;
        uploadFps = uploadFpsMeter.observe(performance.now()) ?? uploadFps;
        pendingFrame = undefined;
        status.text = formatStatus(pendingTimestampUs);
    };
    void decoder.open(source, (frame) => {
        receivedFrames++;
        measuredFps = fpsMeter.observe(performance.now()) ?? measuredFps;
        pendingFrame = frame;
        pendingTimestampUs = frame.timestampUs;
    }, (error) => {
        status.text = `Video error: ${error.message}`;
        console.error("[VideoTest] FFmpeg VA-API decoder failed", error);
    }).catch((error: unknown) => { status.text = `Video error: ${error instanceof Error ? error.message : String(error)}`; });
    scene.on("removed", () => decoder.close());
    return videoScene;
}
