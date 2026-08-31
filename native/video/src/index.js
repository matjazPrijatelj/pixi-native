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

    pollError() {
        return this.decoder.pollError();
    }

    backend() {
        return this.decoder.backend();
    }

    close() {
        this.decoder.close();
    }
}

module.exports = { NativeVideoDecoder };
