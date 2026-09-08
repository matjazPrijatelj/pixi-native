import test from "node:test";
import assert from "node:assert/strict";
import { loadRtpTestConfig } from "../src/demo/v8/rtpTestConfig.ts";

test("RTP test remains disabled until both local URLs are configured", () => {
  assert.equal(loadRtpTestConfig({}), null);
  assert.equal(
    loadRtpTestConfig({ RTP_TEST_URL_1: "http://camera-1/stream" }),
    null,
  );
});

test("RTP config builds low-latency FFmpeg input arguments", () => {
  const config = loadRtpTestConfig({
    RTP_TEST_URL_1: "http://camera-1/stream",
    RTP_TEST_URL_2: "http://camera-2/stream",
    RTP_TEST_LOCAL_ADDRESS: "10.1.45.80",
    RTP_TEST_WIDTH: "1280",
    RTP_TEST_HEIGHT: "720",
    RTP_TEST_FPS: "30",
    RTP_TEST_EXTRA_INPUT_ARGS_JSON: '["-rw_timeout","2000000"]',
  });
  assert.ok(config);
  assert.deepEqual(config.urls, [
    "http://camera-1/stream",
    "http://camera-2/stream",
  ]);
  assert.equal(config.width, 1280);
  assert.equal(config.height, 720);
  assert.equal(config.fps, 30);
  assert.deepEqual(config.inputArgs, [
    "-protocol_whitelist",
    "file,http,https,tcp,udp,rtp",
    "-localaddr",
    "10.1.45.80",
    "-fflags",
    "nobuffer",
    "-flags",
    "low_delay",
    "-probesize",
    "32768",
    "-analyzeduration",
    "100000",
    "-rw_timeout",
    "2000000",
  ]);
});

test("RTP config rejects malformed extra arguments", () => {
  assert.throws(
    () =>
      loadRtpTestConfig({
        RTP_TEST_URL_1: "one",
        RTP_TEST_URL_2: "two",
        RTP_TEST_EXTRA_INPUT_ARGS_JSON: "{}",
      }),
    /JSON string array/,
  );
});
