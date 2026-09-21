export const WIN32_NATIVE_VIDEO_FFMPEG_DLLS = [
  "avcodec-62.dll",
  "avformat-62.dll",
  "avutil-60.dll",
  "swresample-6.dll",
  "swscale-9.dll",
];

export function getNativeVideoRuntimeFiles(target) {
  return target === "win32-x64" ? WIN32_NATIVE_VIDEO_FFMPEG_DLLS : [];
}
