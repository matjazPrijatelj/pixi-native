import test from "node:test";
import assert from "node:assert/strict";
import { buildFfmpegArgs, NativeVideoDecoder, RawVideoFrameAssembler, VideoFpsMeter } from "../src/video/NativeVideoDecoder.ts";
import type { NativeVideoDecoderInfo } from "../src/video/NativeVideoDecoder.ts";

test("FFmpeg command requires VA-API hardware decoding", () => {
    const args = buildFfmpegArgs("video.mp4", { width: 1280, height: 720, fps: 30, vaapiDevice: "/dev/dri/test" });
    assert.deepEqual(args.slice(0, 11), ["-hide_banner", "-loglevel", "error", "-nostdin", "-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/test", "-hwaccel_output_format", "vaapi", "-re"]);
    assert.equal(args.includes("-re"), true);
    assert.ok(args.includes("hwdownload,format=nv12,scale=1280:720:flags=fast_bilinear,format=rgba"));
    assert.equal(args.at(-1), "pipe:1");
});

test("RawVideoFrameAssembler handles partial chunks", () => {
    const assembler = new RawVideoFrameAssembler(2, 1, 30);
    assert.deepEqual(assembler.append(new Uint8Array([1, 2, 3])), []);
    const frames = assembler.append(new Uint8Array([4, 5, 6, 7, 8]));
    assert.equal(frames.length, 1);
    assert.deepEqual([...frames[0].data], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(frames[0].timestampUs, 0);
});

test("NativeVideoDecoder validates dimensions and FPS", () => {
    assert.throws(() => new NativeVideoDecoder({ width: 0, height: 720 }), /dimensions/);
    assert.throws(() => new NativeVideoDecoder({ width: 1280, height: 720, fps: 0 }), /FPS/);
});

test("NativeVideoDecoder exposes decoder type and target FPS", () => {
    const decoder = new NativeVideoDecoder({ width: 1280, height: 720, fps: 30 });
    const info: NativeVideoDecoderInfo = decoder.info;
    assert.deepEqual(info, { decoderType: "FFmpeg H.264", hardwareBackend: "VA-API", targetFps: 30 });
});

test("VideoFpsMeter reports measured FPS after its sample window", () => {
    const meter = new VideoFpsMeter(500);
    assert.equal(meter.observe(1000), null);
    assert.equal(meter.observe(1100), null);
    assert.equal(meter.observe(1500), 6);
});
