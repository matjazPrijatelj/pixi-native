import test from "node:test";
import assert from "node:assert/strict";
import {
    NativeVideo,
    VideoFpsMeter,
    convertBt709LimitedNv12SampleToRgb,
    getNv12FrameLayout,
    resolveFfmpegPath,
    splitNv12Frame,
    type NativeVideoDecoderLike,
    type NativeVideoDecoderOptions,
    type NativeVideoDependencies,
    type NativeVideoFrame,
} from "../src/pixi-node/video/NativeVideo.ts";

test("NV12 layout requires positive even dimensions", () => {
    assert.deepEqual(getNv12FrameLayout(1280, 720), {
        yBytes: 921_600,
        uvBytes: 460_800,
        frameBytes: 1_382_400,
        yStride: 1280,
        uvStride: 1280,
    });
    assert.throws(() => getNv12FrameLayout(1279, 720), /even/);
    assert.throws(() => getNv12FrameLayout(1280, 0), /positive/);
});

test("packed NV12 is split into zero-copy Y and UV views", () => {
    const data = new Uint8Array([16, 32, 48, 64, 128, 192]);
    const frame = splitNv12Frame({
        width: 2,
        height: 2,
        timestampUs: 125_000,
        data,
    });

    assert.deepEqual([...frame.y], [16, 32, 48, 64]);
    assert.deepEqual([...frame.uv], [128, 192]);
    assert.equal(frame.y.buffer, data.buffer);
    assert.equal(frame.uv.buffer, data.buffer);
    assert.equal(frame.uv.byteOffset, data.byteOffset + 4);
    assert.equal(frame.pixelFormat, "nv12");
});

test("FFmpeg path resolution prefers explicit, environment, bundled, then system", () => {
    assert.equal(
        resolveFfmpegPath({
            explicitPath: "D:\\tools\\ffmpeg.exe",
            environment: { FFMPEG_PATH: "ignored" },
            pathExists: () => true,
        }),
        "D:\\tools\\ffmpeg.exe",
    );
    assert.equal(
        resolveFfmpegPath({
            environment: { FFMPEG_PATH: "C:\\app\\ffmpeg.exe" },
            pathExists: () => true,
        }),
        "C:\\app\\ffmpeg.exe",
    );

    const bundled = resolveFfmpegPath({
        platform: "win32",
        arch: "x64",
        environment: {},
        pathExists: () => true,
    });
    assert.match(bundled, /native[\\/]video[\\/]dist[\\/]win32-x64[\\/]ffmpeg\.exe$/);
    assert.equal(
        resolveFfmpegPath({
            platform: "win32",
            arch: "x64",
            environment: {},
            pathExists: () => false,
        }),
        "ffmpeg",
    );
});

test("BT.709 limited conversion maps video black and white", () => {
    const black = convertBt709LimitedNv12SampleToRgb(16, 128, 128);
    const white = convertBt709LimitedNv12SampleToRgb(235, 128, 128);
    assert.ok(black.every((value) => Math.abs(value) < 0.0001));
    assert.ok(white.every((value) => Math.abs(value - 1) < 0.0001));
});

test("NativeVideo restarts at currentTime for pause, resume, and seek", async () => {
    const factory = new FakeDecoderFactory();
    const video = new NativeVideo(
        "video.mp4",
        { width: 2, height: 2, fps: 24 },
        factory,
    );

    await video.play();
    assert.equal(video.paused, false);
    assert.equal(factory.options[0].startTime, 0);

    factory.decoders[0].frame = createFrame(1_250_000);
    assert.equal(video.takeLatestFrame()?.timestampUs, 1_250_000);
    assert.equal(video.currentTime, 1.25);
    video.markFramePresented();

    video.pause();
    assert.equal(video.paused, true);
    assert.equal(factory.decoders[0].closed, true);

    await video.play();
    assert.equal(factory.options[1].startTime, 1.25);

    video.currentTime = 8.5;
    assert.equal(factory.decoders[1].closed, true);
    assert.equal(factory.options[2].startTime, 8.5);
    assert.equal(video.stats.presentedFrames, 1);

    video.destroy();
    video.destroy();
    assert.equal(factory.decoders[2].closed, true);
    await assert.rejects(video.play(), /destroyed/);
});

test("NativeVideo records end and latest-frame decoder statistics", async () => {
    const factory = new FakeDecoderFactory();
    const video = new NativeVideo(
        "video.mp4",
        { width: 2, height: 2 },
        factory,
    );
    await video.play();
    factory.decoders[0].decoded = 5;
    factory.decoders[0].dropped = 3;
    factory.decoders[0].finished = true;

    assert.equal(video.takeLatestFrame(), null);
    assert.equal(video.ended, true);
    assert.equal(video.paused, true);
    assert.deepEqual(video.stats, {
        decodedFrames: 5,
        presentedFrames: 0,
        droppedFrames: 3,
        bytesPerFrame: 6,
    });
});

test("VideoFpsMeter reports measured FPS after its sample window", () => {
    const meter = new VideoFpsMeter(500);
    assert.equal(meter.observe(1000), null);
    assert.equal(meter.observe(1100), null);
    assert.equal(meter.observe(1500), 6);
});

class FakeDecoderFactory implements NativeVideoDependencies {
    public readonly options: NativeVideoDecoderOptions[] = [];
    public readonly decoders: FakeDecoder[] = [];

    public createDecoder(options: NativeVideoDecoderOptions): FakeDecoder {
        this.options.push(options);
        const decoder = new FakeDecoder();
        this.decoders.push(decoder);
        return decoder;
    }
}

class FakeDecoder implements NativeVideoDecoderLike {
    public frame: NativeVideoFrame | null = null;
    public error: string | null = null;
    public decoded = 0;
    public dropped = 0;
    public finished = false;
    public closed = false;

    public open(_source: string): void {}

    public pollLatest(): NativeVideoFrame | null {
        const frame = this.frame;
        this.frame = null;
        return frame;
    }

    public pollError(): string | null {
        const error = this.error;
        this.error = null;
        return error;
    }

    public backend(): string {
        return "fake";
    }

    public decodedFrames(): number {
        return this.decoded;
    }

    public droppedFrames(): number {
        return this.dropped;
    }

    public isFinished(): boolean {
        return this.finished;
    }

    public close(): void {
        this.closed = true;
    }
}

function createFrame(timestampUs: number): NativeVideoFrame {
    const data = new Uint8Array([16, 16, 16, 16, 128, 128]);
    return {
        width: 2,
        height: 2,
        timestampUs,
        y: data.subarray(0, 4),
        uv: data.subarray(4),
        yStride: 2,
        uvStride: 2,
        pixelFormat: "nv12",
    };
}
