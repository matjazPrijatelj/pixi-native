const { createRequire } = require("node:module");
const path = require("node:path");
const { getBindingPath } = require("./binding-path.js");
const requireNative = createRequire(__filename);

const bindingPath = getBindingPath();
if (process.platform === "win32") {
    const runtimeDirectory = path.dirname(bindingPath);
    process.env.PATH = `${runtimeDirectory};${process.env.PATH ?? ""}`;
}
const native = requireNative(bindingPath);

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

    isFinished() {
        return this.decoder.isFinished();
    }

    close() {
        this.decoder.close();
    }
}

module.exports = {
    NativeVideoDecoder,
    linkedFfmpegVersion: native.linkedFfmpegVersion,
};
