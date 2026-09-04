import { Container, Text } from "pixi.js";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";
import { loadRtpTestConfig } from "../rtpTestConfig.ts";
import { NativeVideo, NativeVideoSprite } from "../../../pixi-native/video/index.ts";

export function createRtpVideoTest(
    viewport: { width: number; height: number },
): DisposableDemoScene {
    const scene = new Container() as DisposableDemoScene & {
        resize(width: number, height: number): void;
        update(): void;
    };
    const title = new Text({
        text: "RTP VIDEO TEST  [7]  two live streams",
        style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff },
    });
    scene.addChild(title);

    let config: ReturnType<typeof loadRtpTestConfig>;
    try {
        config = loadRtpTestConfig();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = createMetricBitmapText(`Invalid RTP .env: ${message}`, 18);
        status.position.set(24, 64);
        scene.addChild(status);
        scene.resize = (): void => undefined;
        scene.update = (): void => undefined;
        scene.dispose = (): void => scene.destroy({ children: true });
        return scene;
    }

    if (!config) {
        const status = createMetricBitmapText(
            "Set RTP_TEST_URL_1 and RTP_TEST_URL_2 in the local .env file.",
            18,
        );
        status.position.set(24, 64);
        scene.addChild(status);
        scene.resize = (): void => undefined;
        scene.update = (): void => undefined;
        scene.dispose = (): void => scene.destroy({ children: true });
        return scene;
    }

    const videos = config.urls.map((source) => new NativeVideo(source, {
        width: config.width,
        height: config.height,
        fps: config.fps,
        mediaType: "live",
        audio: false,
        reconnect: { initialDelayMs: 500, maxDelayMs: 5_000 },
        ffmpeg: {
            inputArgs: config.inputArgs,
            inputPacing: "source",
        },
    }));
    const sprites = videos.map((video) => new NativeVideoSprite(video));
    const statuses = videos.map((_video, index) => {
        const status = createMetricBitmapText(`Camera ${index + 1}: connecting`, 16);
        scene.addChild(status);
        return status;
    });
    scene.addChild(...sprites);

    scene.resize = (width, height): void => {
        const top = 92;
        const gap = 8;
        const availableWidth = Math.max(1, width - gap);
        const cellWidth = availableWidth / 2;
        const cellHeight = Math.max(1, height - top - 34);
        for (let index = 0; index < sprites.length; index++) {
            const sprite = sprites[index];
            const scale = Math.min(cellWidth / config.width, cellHeight / config.height);
            sprite.width = config.width * scale;
            sprite.height = config.height * scale;
            sprite.position.set(
                index * (cellWidth + gap) + (cellWidth - sprite.width) / 2,
                top + (cellHeight - sprite.height) / 2,
            );
            statuses[index].position.set(index * (cellWidth + gap) + 12, 60);
        }
    };

    let nextStatusUpdate = 0;
    scene.update = (): void => {
        const now = performance.now();
        if (now < nextStatusUpdate) return;
        nextStatusUpdate = now + 250;
        for (let index = 0; index < videos.length; index++) {
            const video = videos[index];
            const stats = video.stats;
            const state = video.reconnecting
                ? `reconnecting (${video.reconnectAttempts})`
                : video.error
                    ? "stream error"
                    : video.paused ? "paused" : "playing";
            statuses[index].text =
                `Camera ${index + 1}: ${state} / ${video.backend}` +
                ` / decoded-presented-dropped-skipped ${stats.decodedFrames}-` +
                `${stats.presentedFrames}-${stats.droppedFrames}-${stats.skippedFrames}`;
        }
    };

    scene.resize(viewport.width, viewport.height);
    for (const video of videos) void video.play();

    let disposed = false;
    scene.dispose = (): void => {
        if (disposed) return;
        disposed = true;
        scene.update = (): void => undefined;
        for (const video of videos) video.destroy();
        scene.destroy({ children: true });
    };
    return scene;
}

