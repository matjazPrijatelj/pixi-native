const Fs = require("node:fs");
const Path = require("node:path");

const packagedNativeRoot = Path.join(__dirname, "native");
const workspaceNativeRoot = Path.resolve(__dirname, "..", "..", "native");
const nativeRoot = Fs.existsSync(packagedNativeRoot)
  ? packagedNativeRoot
  : workspaceNativeRoot;
const target = "linux-x64";

module.exports = {
  target,
  gpuModule: Path.join(nativeRoot, "gpu", "src", "index.js"),
  windowModule: Path.join(nativeRoot, "window", "src", "index.js"),
  videoModule: Path.join(nativeRoot, "video", "src", "index.js"),
  ffmpeg: Path.join(nativeRoot, "video", "dist", target, "ffmpeg"),
  ffprobe: Path.join(nativeRoot, "video", "dist", target, "ffprobe"),
};
