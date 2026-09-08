export const FFMPEG_SOURCE_URL = "https://github.com/FFmpeg/FFmpeg.git";
export const FFMPEG_SOURCE_COMMIT = "140fd653aed8cad774f991ba083e2d01e86420c7";
export const FFMPEG_SOURCE_REVISION = FFMPEG_SOURCE_COMMIT.slice(0, 10);
export const FFMPEG_SOURCE_ARCHIVE = `ffmpeg-source-8.0-${FFMPEG_SOURCE_REVISION}.tar.gz`;
export const FFMPEG_BUILD_INFO_FILE = "FFMPEG_BUILD_INFO.txt";

export const FFMPEG_CONFIGURE_OPTIONS = [
  "--arch=x86_64",
  "--target-os=mingw32",
  "--cc=gcc",
  "--cxx=g++",
  "--disable-autodetect",
  "--disable-debug",
  "--disable-doc",
  "--disable-shared",
  "--enable-static",
  "--disable-gpl",
  "--disable-nonfree",
  "--disable-version3",
  "--disable-everything",
  "--enable-small",
  "--enable-ffmpeg",
  "--enable-ffprobe",
  "--enable-avcodec",
  "--enable-avformat",
  "--enable-avfilter",
  "--enable-swresample",
  "--enable-swscale",
  "--enable-network",
  "--enable-schannel",
  "--enable-w32threads",
  "--enable-d3d11va",
  "--enable-hwaccel=h264_d3d11va",
  "--enable-hwaccel=hevc_d3d11va",
  "--enable-decoder=h264,hevc,aac,mp3,pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le",
  "--enable-parser=h264,hevc,aac,mpegaudio",
  "--enable-demuxer=mov,mpegts,h264,hevc,aac,mp3,wav,sdp,rtp",
  "--enable-protocol=file,pipe,http,https,tls,tcp,udp,rtp",
  "--enable-filter=fps,scale,format,hwdownload,atempo,aresample,aformat",
  "--enable-encoder=rawvideo,pcm_f32le",
  "--enable-muxer=rawvideo,pcm_f32le,null",
  "--extra-cflags=-Os",
  "--extra-ldflags=-static -static-libgcc",
];

export function createFfmpegBuildInfo(compilerVersion) {
  return [
    "pixi-native minimal FFmpeg build",
    "",
    "Target: win32-x64",
    `Source: ${FFMPEG_SOURCE_URL}`,
    `Source commit: ${FFMPEG_SOURCE_COMMIT}`,
    "License profile: LGPL 2.1 or later",
    "Linkage: static FFmpeg libraries; Windows system DLLs only",
    `Compiler: ${compilerVersion}`,
    "",
    "Configure options:",
    ...FFMPEG_CONFIGURE_OPTIONS,
    "",
  ].join("\n");
}
