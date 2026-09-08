import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FFMPEG_BUILD_INFO_FILE,
  FFMPEG_CONFIGURE_OPTIONS,
  FFMPEG_SOURCE_COMMIT,
  FFMPEG_SOURCE_URL,
} from "./ffmpeg-build-config.mjs";

const HTTP_BYTE_RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;

export const FFMPEG_TARGET_DIRECTORY = "native/video/dist/win32-x64";
export const FFMPEG_CHECKSUM_FILE = "FFMPEG_SHA256SUMS";
export const FFMPEG_LICENSE_FILE = "FFMPEG_LICENSE.txt";
export const FFMPEG_BINARY_FILES = ["ffmpeg.exe", "ffprobe.exe"];
export const FFMPEG_PACKAGED_FILES = [
  ...FFMPEG_BINARY_FILES,
  FFMPEG_LICENSE_FILE,
  FFMPEG_BUILD_INFO_FILE,
];
export const OBSOLETE_SHARED_FFMPEG_FILES = [
  "avcodec-62.dll",
  "avdevice-62.dll",
  "avfilter-11.dll",
  "avformat-62.dll",
  "avutil-60.dll",
  "swresample-6.dll",
  "swscale-9.dll",
  "FFMPEG_README.txt",
];

function runAndCapture(executable, args) {
  const environment = runtimeEnvironment();
  return execFileSync(executable, args, {
    encoding: "utf8",
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function runtimeEnvironment() {
  return process.platform === "win32"
    ? {
        ...process.env,
        PATH: `${process.env.SystemRoot ?? "C:\\Windows"}\\System32;${process.env.SystemRoot ?? "C:\\Windows"}`,
      }
    : process.env;
}

function runAsync(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: runtimeEnvironment(),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const errors = [];
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            Buffer.concat(errors).toString("utf8").trim() ||
              `${executable} exited with code ${code}.`,
          ),
        );
    });
  });
}

function requireText(text, marker, description) {
  if (!text.includes(marker)) {
    throw new Error(
      `FFmpeg ${description} is missing required marker: ${marker}`,
    );
  }
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function writeFfmpegChecksums(directory) {
  const lines = [];
  for (const filename of FFMPEG_PACKAGED_FILES) {
    lines.push(`${await sha256File(join(directory, filename))}  ${filename}`);
  }
  await writeFile(
    join(directory, FFMPEG_CHECKSUM_FILE),
    `${lines.join("\n")}\n`,
  );
}

export async function validateFfmpegChecksums(directory) {
  const checksumText = await readFile(
    join(directory, FFMPEG_CHECKSUM_FILE),
    "utf8",
  );
  const checksumPattern = /^([a-f0-9]{64})  ([^/\\]+)$/;
  const recorded = new Map();
  for (const line of checksumText.trimEnd().split(/\r?\n/)) {
    const match = checksumPattern.exec(line);
    if (!match || recorded.has(match[2])) {
      throw new Error(`Invalid FFmpeg checksum entry: ${line}`);
    }
    recorded.set(match[2], match[1]);
  }

  const expected = new Set(FFMPEG_PACKAGED_FILES);
  const unexpected = [...recorded.keys()].filter(
    (filename) => !expected.has(filename),
  );
  const missing = FFMPEG_PACKAGED_FILES.filter(
    (filename) => !recorded.has(filename),
  );
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `FFmpeg checksum inventory mismatch. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}.`,
    );
  }

  for (const filename of FFMPEG_PACKAGED_FILES) {
    const actual = await sha256File(join(directory, filename));
    if (actual !== recorded.get(filename)) {
      throw new Error(`FFmpeg checksum mismatch for ${filename}.`);
    }
  }
}

export async function validateFfmpegIdentity(directory, executeBinaries) {
  const buildInfo = await readFile(
    join(directory, FFMPEG_BUILD_INFO_FILE),
    "utf8",
  );
  const license = await readFile(join(directory, FFMPEG_LICENSE_FILE), "utf8");
  requireText(buildInfo, `Source: ${FFMPEG_SOURCE_URL}`, "build info");
  requireText(
    buildInfo,
    `Source commit: ${FFMPEG_SOURCE_COMMIT}`,
    "build info",
  );
  requireText(buildInfo, "License profile: LGPL 2.1 or later", "build info");
  requireText(
    buildInfo,
    "Linkage: static FFmpeg libraries; Windows system DLLs only",
    "build info",
  );
  for (const option of FFMPEG_CONFIGURE_OPTIONS)
    requireText(buildInfo, option, "build info");
  requireText(license, "GNU LESSER GENERAL PUBLIC LICENSE", "license");
  requireText(license, "Version 2.1, February 1999", "license");

  if (!executeBinaries) return;
  for (const executable of ["ffmpeg.exe", "ffprobe.exe"]) {
    const version = runAndCapture(join(directory, executable), ["-version"]);
    const normalizedVersion = version.replaceAll("'", "");
    if (!/^ff(?:mpeg|probe) version n?8\.0(?:\s|$)/m.test(version)) {
      throw new Error(
        `${executable} does not identify the pinned FFmpeg 8.0 source.`,
      );
    }
    for (const option of FFMPEG_CONFIGURE_OPTIONS)
      requireText(normalizedVersion, option, `${executable} configuration`);
    const licenseOutput = runAndCapture(join(directory, executable), ["-L"]);
    if (!/GNU Lesser General Public\s+License/.test(licenseOutput)) {
      throw new Error(
        `${executable} does not report the expected LGPL license.`,
      );
    }
    if (/configuration:.*--enable-(?:gpl|nonfree)/.test(normalizedVersion)) {
      throw new Error(
        `${executable} unexpectedly enables GPL or nonfree components.`,
      );
    }
  }
}

function requireNamedRows(output, names, description, rowPattern) {
  for (const name of names) {
    if (!rowPattern(name).test(output)) {
      throw new Error(
        `FFmpeg does not provide required ${description}: ${name}`,
      );
    }
  }
}

export function validateFfmpegCapabilities(directory) {
  const ffmpeg = join(directory, "ffmpeg.exe");
  const protocols = runAndCapture(ffmpeg, ["-hide_banner", "-protocols"]);
  const protocolNames = new Set(
    protocols
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[a-z0-9]+$/.test(line)),
  );
  for (const protocol of [
    "file",
    "pipe",
    "http",
    "https",
    "tls",
    "tcp",
    "udp",
    "rtp",
  ]) {
    if (!protocolNames.has(protocol)) {
      throw new Error(`FFmpeg does not provide required protocol: ${protocol}`);
    }
  }

  const demuxers = runAndCapture(ffmpeg, ["-hide_banner", "-demuxers"]);
  const demuxerRow = (name) =>
    new RegExp(`^\\s*D\\s+[^\\r\\n]*\\b${name}\\b`, "m");
  requireNamedRows(
    demuxers,
    ["mp4", "mpegts", "h264", "hevc", "aac", "mp3", "wav", "sdp", "rtp"],
    "demuxer",
    demuxerRow,
  );

  const decoders = runAndCapture(ffmpeg, ["-hide_banner", "-decoders"]);
  const decoderRow = (name) =>
    new RegExp(`^\\s*[A-Z.]{6}\\s+${name}(?:\\s|$)`, "m");
  requireNamedRows(
    decoders,
    [
      "h264",
      "hevc",
      "aac",
      "mp3",
      "pcm_u8",
      "pcm_s16le",
      "pcm_s24le",
      "pcm_s32le",
      "pcm_f32le",
      "pcm_f64le",
    ],
    "decoder",
    decoderRow,
  );

  const filters = runAndCapture(ffmpeg, ["-hide_banner", "-filters"]);
  const filterRow = (name) =>
    new RegExp(`^\\s*[TSC.]{2}\\s+${name}(?:\\s|$)`, "m");
  requireNamedRows(
    filters,
    ["fps", "scale", "format", "hwdownload", "atempo", "aresample", "aformat"],
    "filter",
    filterRow,
  );

  const muxers = runAndCapture(ffmpeg, ["-hide_banner", "-muxers"]);
  const muxerRow = (name) =>
    new RegExp(`^\\s*E\\s+[^\\r\\n]*\\b${name}\\b`, "m");
  requireNamedRows(muxers, ["rawvideo", "f32le"], "muxer", muxerRow);

  const accelerators = runAndCapture(ffmpeg, ["-hide_banner", "-hwaccels"]);
  if (!/^d3d11va$/m.test(accelerators)) {
    throw new Error(
      "FFmpeg does not provide required hardware acceleration: d3d11va",
    );
  }
}

export async function runFfmpegSmokeTests(
  directory,
  videoFixture,
  audioFixture,
  hevcFixture,
) {
  const ffmpeg = join(directory, "ffmpeg.exe");
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      videoFixture,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=64:64,format=nv12",
      "-f",
      "rawvideo",
      "-y",
      "NUL",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      audioFixture,
      "-map",
      "0:a:0",
      "-t",
      "0.1",
      "-af",
      "atempo=1.25",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-y",
      "NUL",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      videoFixture,
      "-map",
      "0:a:0",
      "-t",
      "0.1",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "f32le",
      "-y",
      "NUL",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  if (hevcFixture) {
    execFileSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        hevcFixture,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "format=nv12",
        "-f",
        "rawvideo",
        "-y",
        "NUL",
      ],
      { stdio: "ignore", windowsHide: true },
    );
  }

  const videoSize = (await stat(videoFixture)).size;
  const server = createServer((request, response) => {
    const range = request.headers.range;
    const match = range ? HTTP_BYTE_RANGE_PATTERN.exec(range) : null;
    const start = match ? Number(match[1]) : 0;
    const requestedEnd = match?.[2] ? Number(match[2]) : videoSize - 1;
    const end = Math.min(requestedEnd, videoSize - 1);
    if (range && (!match || start > end || start >= videoSize)) {
      response.writeHead(416, {
        "Content-Range": `bytes */${videoSize}`,
      });
      response.end();
      return;
    }
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "video/mp4",
    };
    if (match) headers["Content-Range"] = `bytes ${start}-${end}/${videoSize}`;
    response.writeHead(match ? 206 : 200, headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(videoFixture, { start, end }).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Could not resolve FFmpeg smoke-test HTTP port.");
    await runAsync(ffmpeg, [
      "-v",
      "error",
      "-i",
      `http://127.0.0.1:${address.port}/fixture.mp4`,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "format=nv12",
      "-f",
      "rawvideo",
      "-y",
      "NUL",
    ]);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
