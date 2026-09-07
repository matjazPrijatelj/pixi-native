import test from "node:test";
import assert from "node:assert/strict";
import { VideoEventMonitor } from "../src/demo/VideoEventMonitor.ts";

class FakeVideo extends EventTarget {
  public currentTime = 0;
  public readyState = 0;
  public paused = true;
  public error: Error | null = null;

  public emit(type: string): void {
    this.dispatchEvent(new Event(type));
  }
}

function emitReadyPlayback(video: FakeVideo, metadataFirst = true): void {
  video.emit(metadataFirst ? "loadedmetadata" : "play");
  video.emit(metadataFirst ? "play" : "loadedmetadata");
  video.emit("loadeddata");
  video.emit("canplay");
  video.emit("canplaythrough");
  video.emit("playing");
  video.currentTime = 0.25;
  video.emit("timeupdate");
}

test("video event monitor accepts both metadata/play orders", () => {
  for (const metadataFirst of [true, false]) {
    const video = new FakeVideo();
    const logged: string[] = [];
    const monitor = new VideoEventMonitor(
      video,
      () => undefined,
      (line) => logged.push(line),
    );

    monitor.beginSource("first.mp4", false);
    emitReadyPlayback(video, metadataFirst);

    assert.equal(monitor.result, "PASS");
    assert.match(monitor.snapshot.detail, /complete/);
    assert.ok(logged.some((line) => line.includes("first.mp4 playing")));
    monitor.dispose();
  }
});

test("video event monitor requires emptied when src changes", () => {
  const video = new FakeVideo();
  const logged: string[] = [];
  const monitor = new VideoEventMonitor(
    video,
    () => undefined,
    (line) => logged.push(line),
  );

  monitor.beginSource("second.mp4", true);
  video.emit("emptied");
  emitReadyPlayback(video);

  assert.equal(monitor.result, "PASS");
  assert.ok(logged.some((line) => line.includes("second.mp4 emptied")));
  monitor.dispose();
});

test("video event monitor fails an invalid readiness order or video error", () => {
  const video = new FakeVideo();
  const monitor = new VideoEventMonitor(
    video,
    () => undefined,
    () => undefined,
  );

  monitor.beginSource("bad-order.mp4", false);
  video.emit("loadedmetadata");
  video.emit("play");
  video.emit("canplay");
  assert.equal(monitor.result, "FAIL");
  assert.match(monitor.snapshot.detail, /expected loadeddata/);

  monitor.beginSource("broken.mp4", false);
  video.error = new Error("decode failed");
  video.emit("error");
  assert.equal(monitor.result, "FAIL");
  assert.equal(monitor.snapshot.detail, "decode failed");
  monitor.dispose();
});

test("starting another source interrupts an incomplete cycle without failing it", () => {
  const video = new FakeVideo();
  const monitor = new VideoEventMonitor(
    video,
    () => undefined,
    () => undefined,
  );

  monitor.beginSource("first.mp4", false);
  video.emit("loadedmetadata");
  monitor.beginSource("second.mp4", true);

  assert.equal(monitor.result, "WAITING");
  assert.ok(monitor.snapshot.entries.includes("INTERRUPTED first.mp4"));
  monitor.dispose();
});
