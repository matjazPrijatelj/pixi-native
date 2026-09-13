const { createRequire } = require("node:module");
const { getBindingPath } = require("./binding-path.js");
const requireNative = createRequire(__filename);

const native = requireNative(getBindingPath());

class NativeVideoDecoder {
  constructor(options) {
    this.decoder = new native.NativeVideoDecoder(options);
  }

  open(source) {
    this.decoder.open(source);
  }

  pollLatest() {
    return this.decoder.pollLatest();
  }

  pollNext() {
    return this.decoder.pollNext();
  }

  supportsFrameBufferReuse() {
    return typeof this.decoder.pollNextInto === "function";
  }

  pollLatestInto(target) {
    return this.pollIntoFallback("pollLatest", "pollLatestInto", target);
  }

  pollNextInto(target) {
    return this.pollIntoFallback("pollNext", "pollNextInto", target);
  }

  queuedFrames() {
    return this.decoder.queuedFrames();
  }

  catchUpTo(timestampUs) {
    this.decoder.catchUpTo(timestampUs);
  }

  pollError() {
    return this.decoder.pollError();
  }

  backend() {
    return this.decoder.backend();
  }

  decodedFrames() {
    return this.decoder.decodedFrames();
  }

  droppedFrames() {
    return this.decoder.droppedFrames();
  }

  skippedFrames() {
    return this.decoder.skippedFrames();
  }

  frameBufferAllocations() {
    return this.decoder.frameBufferAllocations?.() ?? 0;
  }

  frameBufferReuses() {
    return this.decoder.frameBufferReuses?.() ?? 0;
  }

  recycledFrameBuffers() {
    return this.decoder.recycledFrameBuffers?.() ?? 0;
  }

  isFinished() {
    return this.decoder.isFinished();
  }

  close() {
    this.decoder.close();
  }

  pollIntoFallback(pollName, pollIntoName, target) {
    if (typeof this.decoder[pollIntoName] === "function") {
      return this.decoder[pollIntoName](target);
    }
    const frame = this.decoder[pollName]();
    if (!frame) return null;
    if (target.byteLength !== frame.data.byteLength) {
      throw new RangeError(
        `NV12 target has ${target.byteLength} bytes; expected ${frame.data.byteLength}`,
      );
    }
    target.set(frame.data);
    return {
      width: frame.width,
      height: frame.height,
      timestampUs: frame.timestampUs,
    };
  }
}

module.exports = { NativeVideoDecoder };
