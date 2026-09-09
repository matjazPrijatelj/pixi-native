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
  type NativeVideoAudioLike,
  type NativeVideoFrame,
} from "@pixi-native/core/video/NativeVideo.js";
import { VideoEventMonitor } from "../src/demo/VideoEventMonitor.ts";

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
  assert.match(
    bundled,
    /native[\\/]video[\\/]dist[\\/]win32-x64[\\/]ffmpeg\.exe$/,
  );
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
    "video.mp4#t=1.25",
    { width: 2, height: 2, fps: 24 },
    factory,
  );

  await video.play();
  assert.equal(video.paused, false);
  assert.equal(factory.options[0].startTime, 1.25);

  factory.decoders[0].frame = createFrame(1_250_000);
  assert.equal(video.takeLatestFrame()?.timestampUs, 1_250_000);
  assert.ok(Math.abs(video.currentTime - 1.25) < 0.05);
  video.markFramePresented();

  video.pause();
  assert.equal(video.paused, true);
  assert.equal(factory.decoders[0].closed, true);

  await video.play();
  assert.ok(Math.abs((factory.options[1].startTime ?? 0) - 1.25) < 0.05);

  video.currentTime = 8.5;
  assert.equal(factory.decoders[1].closed, true);
  assert.equal(factory.options[2].startTime, 8.5);
  assert.equal(video.stats.presentedFrames, 1);

  video.destroy();
  video.destroy();
  assert.equal(factory.decoders[2].closed, true);
  await assert.rejects(video.play(), /destroyed/);
});

test("changing src resets state and continues active playback on the new source", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo(
    "first.mp4",
    { width: 2, height: 2, audio: false, loop: true, playbackRate: 1.25 },
    factory,
  );
  let emptied = 0;
  video.onemptied = () => emptied++;
  const monitor = new VideoEventMonitor(
    video,
    () => undefined,
    () => undefined,
  );
  monitor.beginSource("first.mp4", false);
  const events: string[] = [];
  for (const type of [
    "emptied",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "canplaythrough",
    "play",
    "playing",
    "timeupdate",
    "error",
  ]) {
    video.addEventListener(type, () => events.push(type));
  }

  await video.play();
  factory.decoders[0].decoded = 4;
  factory.decoders[0].frame = createFrame(0);
  video.takeLatestFrame();
  video.markFramePresented();
  assert.equal(monitor.result, "PASS");

  events.length = 0;

  monitor.beginSource("second.mp4", true);
  const sourceChangeStartedAtMs = performance.now();
  video.src = "second.mp4#t=2,5";
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(emptied, 1);
  assert.equal(factory.decoders[0].closed, true);
  assert.equal(factory.decoders.length, 2);
  assert.equal(factory.decoders[1].source, "second.mp4");
  assert.equal(factory.options[1].startTime, 2);
  assert.equal(factory.options[1].endTime, 5);
  assert.equal(video.src, "second.mp4#t=2,5");
  assert.equal(video.currentSrc, "second.mp4");
  const currentTime = video.currentTime;
  const maximumClockTime =
    2 +
    ((performance.now() - sourceChangeStartedAtMs) / 1000) *
      video.playbackRate +
    0.05;
  assert.ok(currentTime >= 2 && currentTime <= maximumClockTime);
  assert.equal(video.paused, false);
  assert.equal(video.loop, true);
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.error, null);
  assert.equal(video.stats.decodedFrames, 0);
  assert.equal(video.stats.presentedFrames, 0);

  factory.decoders[1].frame = createFrame(2_000_000);
  assert.equal(video.takeLatestFrame()?.timestampUs, 2_000_000);
  video.markFramePresented();

  assert.equal(events[0], "emptied");
  assert.deepEqual(
    new Set(events.slice(1, 3)),
    new Set(["loadedmetadata", "play"]),
  );
  assert.deepEqual(events.slice(3), [
    "loadeddata",
    "canplay",
    "canplaythrough",
    "playing",
    "timeupdate",
  ]);
  assert.equal(monitor.result, "PASS");
  monitor.dispose();
  video.destroy();
});

test("changing src while paused loads only current-source metadata", async () => {
  const factory = new FakeDecoderFactory();
  const metadataResolvers = new Map<
    string,
    (metadata: { width: number; height: number; duration: number }) => void
  >();
  const dependencies = {
    createDecoder: (options: NativeVideoDecoderOptions) =>
      factory.createDecoder(options),
    probeMetadata: (source: string) =>
      new Promise((resolve) => {
        metadataResolvers.set(source, resolve);
      }),
  };
  const video = new NativeVideo(
    "first.mp4",
    { width: 2, height: 2, audio: false },
    dependencies,
  );

  video.load();
  video.src = "second.mp4";
  metadataResolvers.get("first.mp4")?.({ width: 10, height: 12, duration: 20 });
  metadataResolvers.get("second.mp4")?.({
    width: 20,
    height: 24,
    duration: 40,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(video.paused, true);
  assert.equal(factory.decoders.length, 0);
  assert.equal(video.currentSrc, "second.mp4");
  assert.equal(video.videoWidth, 20);
  assert.equal(video.videoHeight, 24);
  assert.equal(video.duration, 40);
  assert.equal(video.readyState, 1);
  video.destroy();
});

test("NativeVideo records end and latest-frame decoder statistics", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo("video.mp4", { width: 2, height: 2 }, factory);
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
    skippedFrames: 0,
    queuedFrames: 0,
    syncOffsetMs: 0,
    bytesPerFrame: 6,
  });
});

test("NativeVideo uses audio as its playback clock and holds early frames", async () => {
  const factory = new FakeAudioVideoFactory();
  const video = new NativeVideo(
    "video-with-audio.mp4",
    { width: 2, height: 2, volume: 0.7 },
    factory,
  );

  await video.play();
  const audio = factory.audios[0];
  assert.equal(audio.played, true);
  assert.equal(video.currentTime, 0);

  factory.decoders[0].frame = createFrame(1_000_000);
  audio.currentTime = 0.5;
  assert.equal(video.takeLatestFrame(), null);
  audio.currentTime = 0.99;
  assert.equal(video.takeLatestFrame()?.timestampUs, 1_000_000);

  video.volume = 0.35;
  video.muted = true;
  assert.equal(audio.volume, 0.35);
  assert.equal(audio.muted, true);

  factory.decoders[0].finished = true;
  assert.equal(video.takeLatestFrame(), null);
  assert.equal(video.ended, false);
  audio.ended = true;
  assert.equal(video.takeLatestFrame(), null);
  assert.equal(video.ended, true);
  assert.equal(audio.destroyed, true);
});

test("file playback waits for a decoded frame before starting audio", async () => {
  const factory = new FakeAudioVideoFactory();
  factory.decoderReady = false;
  const video = new NativeVideo(
    "video-with-audio.mp4",
    { width: 2, height: 2 },
    factory,
  );

  const playing = video.play();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(factory.decoders.length, 1);
  assert.equal(factory.audios.length, 0);

  factory.decoders[0].ready = true;
  await playing;
  assert.equal(factory.audios.length, 1);
  assert.equal(factory.audios[0].played, true);
  video.destroy();
});

test("pausing during file prebuffer prevents a late audio start", async () => {
  const factory = new FakeAudioVideoFactory();
  factory.decoderReady = false;
  const video = new NativeVideo(
    "video-with-audio.mp4",
    { width: 2, height: 2 },
    factory,
  );

  const playing = video.play();
  await new Promise<void>((resolve) => setImmediate(resolve));
  video.pause();
  await playing;

  assert.equal(factory.decoders[0].closed, true);
  assert.equal(factory.audios.length, 0);
  video.destroy();
});

test("NativeVideo drains due frames in order without blocking the decoder queue", async () => {
  const factory = new FakeAudioVideoFactory();
  const video = new NativeVideo(
    "video-with-audio.mp4",
    { width: 2, height: 2, fps: 30 },
    factory,
  );

  await video.play();
  const audio = factory.audios[0];
  const decoder = factory.decoders[0];
  decoder.enqueue(
    createFrame(0),
    createFrame(33_333),
    createFrame(66_667),
    createFrame(100_000),
  );

  audio.currentTime = 0.05;
  assert.equal(video.takeLatestFrame()?.timestampUs, 66_667);
  assert.equal(video.stats.skippedFrames, 2);
  assert.equal(video.stats.queuedFrames, 1);
  assert.ok(Math.abs(video.stats.syncOffsetMs - 16.667) < 0.01);

  decoder.enqueue(createFrame(133_333));
  audio.currentTime = 0.09;
  assert.equal(video.takeLatestFrame()?.timestampUs, 100_000);
  assert.equal(video.stats.queuedFrames, 1);
  assert.ok(Math.abs(video.stats.syncOffsetMs - 10) < 0.01);
});

test("NativeVideo requests native catch-up when a file frame is too late", async () => {
  const factory = new FakeAudioVideoFactory();
  const video = new NativeVideo(
    "video-with-audio.mp4",
    { width: 2, height: 2, fps: 60 },
    factory,
  );

  await video.play();
  const audio = factory.audios[0];
  const decoder = factory.decoders[0];
  decoder.enqueue(createFrame(500_000));
  audio.currentTime = 1;

  assert.equal(video.takeLatestFrame()?.timestampUs, 500_000);
  assert.deepEqual(decoder.catchUpTargets, [980_000]);
  video.destroy();
});

test("NativeVideo without audio presents file frames on its monotonic clock", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo(
    "video.mp4",
    { width: 2, height: 2, audio: false },
    factory,
  );

  await video.play();
  factory.decoders[0].enqueue(
    createFrame(0),
    createFrame(33_333),
    createFrame(66_667),
  );

  assert.equal(video.takeLatestFrame()?.timestampUs, 0);
  await new Promise<void>((resolve) => setTimeout(resolve, 75));
  assert.equal(video.takeLatestFrame()?.timestampUs, 66_667);
  assert.equal(video.stats.queuedFrames, 0);
});

test("video-only modal rendering starts the clock before decoder-ready polling completes", async () => {
  const factory = new FakeDecoderFactory();
  factory.decoderReady = false;
  const video = new NativeVideo(
    "video.mp4",
    { width: 2, height: 2, audio: false },
    factory,
  );

  const playback = video.play();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const decoder = factory.decoders[0];
  decoder.ready = true;
  decoder.enqueue(createFrame(0), createFrame(10_000_000));

  assert.equal(video.takeLatestFrame()?.timestampUs, 0);
  assert.ok(video.currentTime < 1);
  await playback;
  assert.ok(video.currentTime < 1);
  video.destroy();
});

test("NativeVideo dispatches Electron-compatible events and loops without ended", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo(
    "video.mp4#t=0,2",
    { width: 2, height: 2, audio: false, loop: true },
    factory,
  );
  const events: string[] = [];
  for (const type of [
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "canplaythrough",
    "play",
    "playing",
    "ended",
  ]) {
    video.addEventListener(type, () => events.push(type));
  }
  let propertyEnded = 0;
  video.onended = () => {
    propertyEnded++;
  };

  await video.play();
  factory.decoders[0].frame = createFrame(0);
  assert.ok(video.takeLatestFrame());
  video.markFramePresented();
  factory.decoders[0].finished = true;
  assert.equal(video.takeLatestFrame(), null);

  assert.equal(video.ended, false);
  assert.equal(propertyEnded, 0);
  assert.equal(factory.options[1].startTime, 0);
  assert.ok(events.includes("loadedmetadata"));
  assert.deepEqual(
    events.slice(events.indexOf("loadeddata"), events.indexOf("playing") + 1),
    ["loadeddata", "canplay", "canplaythrough", "playing"],
  );
  video.destroy();
});

test("NativeVideo emits pause then ended at a natural file end", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo(
    "video.mp4",
    { width: 2, height: 2, audio: false },
    factory,
  );
  const events: string[] = [];
  for (const type of ["timeupdate", "pause", "ended"]) {
    video.addEventListener(type, () => events.push(type));
  }
  await video.play();
  factory.decoders[0].finished = true;
  video.takeLatestFrame();
  assert.deepEqual(events.slice(-3), ["timeupdate", "pause", "ended"]);
  video.destroy();
});

test("modal playback keeps audio as master clock without restarting A/V", async () => {
  const factory = new FakeAudioVideoFactory();
  const video = new NativeVideo("video.mp4", { width: 2, height: 2 }, factory);
  await video.play();
  factory.audios[0].currentTime = 0.5;
  factory.decoders[0].frame = createFrame(500_000);
  video.takeLatestFrame();

  video.setModalState(true);
  assert.equal(factory.audios[0].destroyed, false);
  factory.audios[0].currentTime = 2;
  factory.decoders[0].frame = createFrame(2_000_000);
  assert.equal(video.takeLatestFrame()?.timestampUs, 2_000_000);
  video.setModalState(false);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(factory.audios.length, 1);
  assert.equal(factory.decoders.length, 1);
  assert.equal(video.currentTime, 2);
  video.destroy();
});

test("live video forwards FFmpeg arguments and reconnects without read pacing", async () => {
  const factory = new FakeDecoderFactory();
  const video = new NativeVideo(
    "http://camera/live.sdp",
    {
      width: 2,
      height: 2,
      audio: false,
      mediaType: "live",
      reconnect: { initialDelayMs: 0, maxDelayMs: 0 },
      ffmpeg: {
        inputPacing: "source",
        inputArgs: ["-fflags", "nobuffer"],
        videoOutputArgs: ["-threads", "1"],
      },
    },
    factory,
  );
  await video.play();
  assert.equal(factory.options[0].sourcePaced, true);
  assert.deepEqual(factory.options[0].inputArgs, ["-fflags", "nobuffer"]);
  assert.deepEqual(factory.options[0].outputArgs, ["-threads", "1"]);

  factory.decoders[0].error = "connection lost";
  video.takeLatestFrame();
  video.takeLatestFrame();
  assert.equal(factory.decoders.length, 2);
  assert.equal(video.ended, false);
  video.destroy();
});

test("a stalled live camera reconnects independently and recovers on presentation", async () => {
  let now = 10_000;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: (): number => now,
  });

  const reconnect = { initialDelayMs: 0, maxDelayMs: 0 } as const;
  const firstFactory = new FakeDecoderFactory();
  const secondFactory = new FakeDecoderFactory();
  const first = new NativeVideo(
    "http://camera-1/live.sdp",
    { width: 2, height: 2, audio: false, mediaType: "live", reconnect },
    firstFactory,
  );
  const second = new NativeVideo(
    "http://camera-2/live.sdp",
    { width: 2, height: 2, audio: false, mediaType: "live", reconnect },
    secondFactory,
  );

  try {
    await Promise.all([first.play(), second.play()]);
    secondFactory.decoders[0].frame = createFrame(0);
    assert.ok(second.takeLatestFrame());
    second.markFramePresented();

    now += 5_000;
    assert.equal(first.takeLatestFrame(), null);
    assert.equal(firstFactory.decoders[0].closed, true);
    assert.match(first.error?.message ?? "", /no presented frame/);

    assert.equal(first.takeLatestFrame(), null);
    assert.equal(firstFactory.decoders.length, 2);
    assert.equal(secondFactory.decoders.length, 1);

    firstFactory.decoders[1].decoded = 1;
    firstFactory.decoders[1].frame = createFrame(0);
    assert.ok(first.takeLatestFrame());
    assert.notEqual(first.error, null);
    first.markFramePresented();
    assert.equal(first.error, null);
    assert.equal(first.reconnectAttempts, 0);
    assert.equal(first.stats.presentedFrames, 1);
    assert.equal(second.stats.presentedFrames, 1);
  } finally {
    first.destroy();
    second.destroy();
    delete (performance as unknown as { now?: () => number }).now;
  }
});

test("playbackRate restarts file audio and video at the same media time", async () => {
  const factory = new FakeAudioVideoFactory();
  const video = new NativeVideo("video.mp4", { width: 2, height: 2 }, factory);
  await video.play();
  factory.audios[0].currentTime = 1.25;
  video.playbackRate = 0.94;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(factory.options.at(-1)?.startTime, 1.25);
  assert.equal(factory.options.at(-1)?.playbackRate, 0.94);
  assert.equal(factory.audioPlaybackRates.at(-1), 0.94);
  video.destroy();
});

test("VideoFpsMeter reports measured FPS after its sample window", () => {
  const meter = new VideoFpsMeter(500);
  assert.equal(meter.observe(1000), null);
  assert.equal(meter.observe(1100), null);
  assert.equal(meter.observe(1500), 4);
});

class FakeDecoderFactory implements NativeVideoDependencies {
  public readonly options: NativeVideoDecoderOptions[] = [];
  public readonly decoders: FakeDecoder[] = [];
  public decoderReady = true;

  public createDecoder(options: NativeVideoDecoderOptions): FakeDecoder {
    this.options.push(options);
    const decoder = new FakeDecoder();
    decoder.ready = this.decoderReady;
    this.decoders.push(decoder);
    return decoder;
  }
}

class FakeAudioVideoFactory extends FakeDecoderFactory {
  public readonly audios: FakeAudio[] = [];
  public readonly audioPlaybackRates: number[] = [];

  public createAudio(
    _source: string,
    startTime: number,
    volume: number,
    muted: boolean,
    playbackRate = 1,
  ): FakeAudio {
    const audio = new FakeAudio(startTime, volume, muted);
    this.audios.push(audio);
    this.audioPlaybackRates.push(playbackRate);
    return audio;
  }
}

class FakeAudio implements NativeVideoAudioLike {
  public ended = false;
  public played = false;
  public destroyed = false;
  public currentTime: number;
  public volume: number;
  public muted: boolean;

  public constructor(currentTime: number, volume: number, muted: boolean) {
    this.currentTime = currentTime;
    this.volume = volume;
    this.muted = muted;
  }

  public async play(): Promise<void> {
    this.played = true;
  }

  public destroy(): void {
    this.destroyed = true;
  }
}

class FakeDecoder implements NativeVideoDecoderLike {
  private frames: NativeVideoFrame[] = [];
  public error: string | null = null;
  public decoded = 0;
  public dropped = 0;
  public skipped = 0;
  public finished = false;
  public closed = false;
  public ready = true;
  public source: string | null = null;
  public readonly catchUpTargets: number[] = [];

  public open(source: string): void {
    this.source = source;
  }

  public get frame(): NativeVideoFrame | null {
    return this.frames[0] ?? null;
  }

  public set frame(frame: NativeVideoFrame | null) {
    this.frames = frame ? [frame] : [];
  }

  public enqueue(...frames: NativeVideoFrame[]): void {
    this.frames.push(...frames);
  }

  public pollLatest(): NativeVideoFrame | null {
    const frame = this.frames.at(-1) ?? null;
    this.frames = [];
    return frame;
  }

  public pollNext(): NativeVideoFrame | null {
    return this.frames.shift() ?? null;
  }

  public queuedFrames(): number {
    return this.frames.length;
  }

  public catchUpTo(timestampUs: number): void {
    this.catchUpTargets.push(timestampUs);
    this.frames = [];
  }

  public isReady(): boolean {
    return this.ready;
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

  public skippedFrames(): number {
    return this.skipped;
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
