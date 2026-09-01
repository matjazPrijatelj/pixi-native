const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

function getBindingPath() {
    const platform = `${process.platform}-${process.arch}`;
    const binding = resolve(__dirname, "dist", platform, "native_audio.node");
    if (!existsSync(binding)) {
        throw new Error(
            `Missing native audio addon for ${platform}: ${binding}. ` +
            "Build it with pnpm native:audio:build on Windows x64."
        );
    }
    return binding;
}

module.exports = { getBindingPath };
