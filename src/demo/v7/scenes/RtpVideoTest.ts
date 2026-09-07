import { Container } from "pixi.js-v7";
import { NativeVideo } from "@pixi-native/core";
import { VideoSprite as NativeVideoSprite7 } from "@pixi-native/pixi7";
import { loadRtpTestConfig } from "../rtpTestConfig.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";

export function createRtpVideoTest(viewport: { width: number; height: number }): Container & { update(deltaMS: number): void; resize(width: number, height: number): void; dispose(): void } {
    const scene = new Container() as Container & { update(deltaMS: number): void; resize(width: number, height: number): void; dispose(): void };
    const title = createMetricBitmapText("RTP VIDEO TEST  [7]", 26);
    scene.addChild(title);
    let videos: NativeVideo[] = [];
    let sprites: NativeVideoSprite7[] = [];
    try {
        const config = loadRtpTestConfig();
        if (config) {
            videos = config.urls.map(url => new NativeVideo(url, { width: config.width, height: config.height, fps: config.fps, mediaType: "live", audio: false, reconnect: { initialDelayMs: 500, maxDelayMs: 5000 }, ffmpeg: { inputArgs: config.inputArgs, inputPacing: "source" } }));
            sprites = videos.map(video => new NativeVideoSprite7(video));
            scene.addChild(...sprites);
            for (const video of videos) void video.play();
        } else title.text = "RTP VIDEO TEST [7] | configure RTP_TEST_URL_1/2";
    } catch (error) { title.text = `RTP VIDEO TEST [7] | ${String(error)}`; }
    scene.resize = (width, height): void => { const cellWidth = Math.max(1, (width - 16) / 2); const cellHeight = Math.max(1, height - 120); for (let i = 0; i < sprites.length; i++) { const sprite = sprites[i]; const scale = Math.min(cellWidth / sprite.video.width, cellHeight / sprite.video.height); sprite.scale.set(scale); sprite.position.set(8 + i * (cellWidth + 8) + (cellWidth - sprite.width) / 2, 92); } };
    scene.update = (): void => { if (videos.length) title.text = `RTP VIDEO TEST [7] | ${videos.map(video => video.stats.presentedFrames).join(" / ")} frames`; };
    scene.dispose = (): void => { for (const sprite of sprites) sprite.destroy(); sprites = []; videos = []; };
    scene.resize(viewport.width, viewport.height);
    return scene;
}
