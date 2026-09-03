import test from "node:test";
import assert from "node:assert/strict";
import { parseMediaSource, redactMediaSource } from "../../pixi-native/video/mediaSource.ts";

test("media fragments are removed and converted to bounded playback times", () => {
    assert.deepEqual(parseMediaSource("video.mp4#t=1.5,8"), {
        source: "video.mp4",
        startTime: 1.5,
        endTime: 8,
    });
    assert.deepEqual(parseMediaSource("video.mp4"), {
        source: "video.mp4",
        startTime: 0,
    });
    assert.throws(() => parseMediaSource("video.mp4#t=8,1"), /end time/);
});

test("authenticated media URLs are redacted without hiding the host", () => {
    assert.equal(
        redactMediaSource("HTTP failed for http://camera-user:secret@10.1.2.3/live.sdp"),
        "HTTP failed for http://***:***@10.1.2.3/live.sdp",
    );
});
