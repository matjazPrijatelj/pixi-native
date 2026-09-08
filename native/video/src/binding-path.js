const path = require("node:path");

const SUPPORTED_TARGETS = new Set(["linux-x64", "win32-x64"]);

function getPlatformDirectory(
  platform = process.platform,
  arch = process.arch,
) {
  const target = `${platform}-${arch}`;
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Native video is unsupported on ${target}`);
  }
  return target;
}

function getBindingPath(platform = process.platform, arch = process.arch) {
  return path.resolve(
    __dirname,
    "..",
    "dist",
    getPlatformDirectory(platform, arch),
    "native_video.node",
  );
}

module.exports = { getBindingPath, getPlatformDirectory };
