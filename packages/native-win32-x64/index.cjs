const Fs = require("node:fs");
const Path = require("node:path");

const packagedNativeRoot = Path.join(__dirname, "native");
const workspaceNativeRoot = Path.resolve(__dirname, "..", "..", "native");
const nativeRoot = Fs.existsSync(packagedNativeRoot)
  ? packagedNativeRoot
  : workspaceNativeRoot;
const target = "win32-x64";

module.exports = {
  target,
  gpuModule: Path.join(nativeRoot, "gpu"),
  windowModule: Path.join(nativeRoot, "window"),
  videoModule: Path.join(nativeRoot, "video", "src", "index.js"),
  audioBinding: Path.join(
    nativeRoot,
    "audio",
    "dist",
    target,
    "native_audio.node",
  ),
  ffmpeg: Path.join(nativeRoot, "video", "dist", target, "ffmpeg.exe"),
  ffprobe: Path.join(nativeRoot, "video", "dist", target, "ffprobe.exe"),
};
