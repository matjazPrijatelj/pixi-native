import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const DURATION_SECONDS = 6;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const DATA_BYTES = FRAME_COUNT * CHANNELS * 2;
const outputDirectory = fileURLToPath(new URL("../assets/audio/", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const DRUMS = [
    { key: "u", sprite: "crash", label: "Crash", duration: 1.4, pan: -0.55, hit: { x: 0.15, y: 0.13, radiusX: 0.13, radiusY: 0.1 } },
    { key: "i", sprite: "closedHat", label: "Closed hi-hat", duration: 0.35, pan: -0.35, hit: { x: 0.35, y: 0.17, radiusX: 0.085, radiusY: 0.055 } },
    { key: "o", sprite: "ride", label: "Ride", duration: 1.2, pan: 0.45, hit: { x: 0.63, y: 0.13, radiusX: 0.13, radiusY: 0.1 } },
    { key: "p", sprite: "highTom", label: "High tom", duration: 0.75, pan: 0.55, hit: { x: 0.86, y: 0.17, radiusX: 0.09, radiusY: 0.08 } },
    { key: "j", sprite: "snare", label: "Snare", duration: 0.6, pan: -0.35, hit: { x: 0.23, y: 0.57, radiusX: 0.105, radiusY: 0.085 } },
    { key: "k", sprite: "kick", label: "Kick", duration: 0.55, pan: 0, hit: { x: 0.49, y: 0.68, radiusX: 0.145, radiusY: 0.19 } },
    { key: "l", sprite: "floorTom", label: "Floor tom", duration: 0.85, pan: 0.35, hit: { x: 0.74, y: 0.62, radiusX: 0.105, radiusY: 0.12 } },
    { key: "č", sprite: "openHat", label: "Open hi-hat", duration: 1, pan: 0.65, hit: { x: 0.9, y: 0.48, radiusX: 0.085, radiusY: 0.06 } },
];

const DRUM_PADDING_SECONDS = 0.25;

const wav = Buffer.alloc(44 + DATA_BYTES);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + DATA_BYTES, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(CHANNELS, 22);
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
wav.writeUInt16LE(CHANNELS * 2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(DATA_BYTES, 40);

for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const seconds = frame / SAMPLE_RATE;
    let sample = 0;
    if (seconds < 0.8) {
        sample = Math.sin(seconds * Math.PI * 2 * 440) * 0.35;
    } else if (seconds >= 1 && seconds < 1.8) {
        sample = Math.sin(seconds * Math.PI * 2 * 660) * 0.35;
    } else if (seconds >= 2) {
        const local = seconds - 2;
        sample =
            (Math.sin(local * Math.PI * 2 * 220) +
                Math.sin(local * Math.PI * 2 * 277.18) +
                Math.sin(local * Math.PI * 2 * 329.63)) *
            0.1;
    }
    const value = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    const offset = 44 + frame * CHANNELS * 2;
    wav.writeInt16LE(value, offset);
    wav.writeInt16LE(value, offset + 2);
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/howler-test.wav`, wav);
await writeFile(
    `${outputDirectory}/howler-test.json`,
    `${JSON.stringify(
        {
            src: ["howler-test.wav"],
            sprite: {
                toneA: [0, 800],
                toneB: [1000, 800],
                music: [2000, 4000, true],
            },
        },
        null,
        2,
    )}\n`,
);

const drumSprite = {};
let drumDurationSeconds = DRUM_PADDING_SECONDS;
for (const drum of DRUMS) {
    drumSprite[drum.sprite] = [
        Math.round(drumDurationSeconds * 1000),
        Math.round(drum.duration * 1000),
    ];
    drumDurationSeconds += drum.duration + DRUM_PADDING_SECONDS;
}

const drumFrameCount = Math.ceil(drumDurationSeconds * SAMPLE_RATE);
const drumPcm = Buffer.alloc(drumFrameCount * CHANNELS * 2);
let randomState = 0x5eed1234;
let previousNoise = 0;
for (let frame = 0; frame < drumFrameCount; frame++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    const noise = (randomState / 0xffffffff) * 2 - 1;
    const highNoise = noise - previousNoise * 0.85;
    previousNoise = noise;
    const seconds = frame / SAMPLE_RATE;
    let sample = 0;
    let pan = 0;

    for (const drum of DRUMS) {
        const [offsetMs] = drumSprite[drum.sprite];
        const local = seconds - offsetMs / 1000;
        if (local < 0 || local >= drum.duration) continue;
        sample = synthesizeDrum(drum.sprite, local, noise, highNoise);
        pan = drum.pan;
        break;
    }

    const leftGain = Math.sqrt((1 - pan) / 2);
    const rightGain = Math.sqrt((1 + pan) / 2);
    const offset = frame * CHANNELS * 2;
    drumPcm.writeInt16LE(toPcm16(sample * leftGain), offset);
    drumPcm.writeInt16LE(toPcm16(sample * rightGain), offset + 2);
}

const drumAtlasPath = join(outputDirectory, "drum-kit-atlas.mp3");
await encodeMp3(drumPcm, drumAtlasPath);
await writeFile(
    join(outputDirectory, "drum-kit-atlas.json"),
    `${JSON.stringify(
        {
            src: ["drum-kit-atlas.mp3"],
            texture: "../drum-kit.png",
            sprite: drumSprite,
            pads: DRUMS.map(({ key, sprite, label, hit }) => ({
                key,
                sprite,
                label,
                hit,
            })),
        },
        null,
        2,
    )}\n`,
);

function synthesizeDrum(sprite, time, noise, highNoise) {
    if (sprite === "kick") {
        const envelope = Math.exp(-time * 10);
        const phase = Math.PI * 2 * (48 * time + 18 * (1 - Math.exp(-time * 18)));
        return Math.sin(phase) * envelope * 0.95;
    }
    if (sprite === "snare") {
        return (
            highNoise * Math.exp(-time * 13) * 0.72 +
            Math.sin(Math.PI * 2 * 185 * time) * Math.exp(-time * 20) * 0.35
        );
    }
    if (sprite === "closedHat" || sprite === "openHat") {
        const decay = sprite === "closedHat" ? 34 : 5.5;
        const metallic =
            Math.sin(Math.PI * 2 * 6100 * time) * 0.18 +
            Math.sin(Math.PI * 2 * 8270 * time) * 0.12;
        return (highNoise * 0.65 + metallic) * Math.exp(-time * decay) * 0.75;
    }
    if (sprite === "crash" || sprite === "ride") {
        const decay = sprite === "crash" ? 2.7 : 3.8;
        const metallic =
            Math.sin(Math.PI * 2 * 1730 * time) +
            Math.sin(Math.PI * 2 * 2380 * time) * 0.7 +
            Math.sin(Math.PI * 2 * 3190 * time) * 0.5;
        const attack = Math.min(1, time * 180);
        return (highNoise * 0.42 + metallic * 0.18) * attack * Math.exp(-time * decay);
    }
    const isFloorTom = sprite === "floorTom";
    const baseFrequency = isFloorTom ? 82 : 145;
    const frequencyDrop = isFloorTom ? 42 : 65;
    const phase = Math.PI * 2 * (
        baseFrequency * time +
        frequencyDrop * (1 - Math.exp(-time * 11)) / 11
    );
    return (
        Math.sin(phase) * Math.exp(-time * (isFloorTom ? 5 : 7)) * 0.85 +
        noise * Math.exp(-time * 25) * 0.12
    );
}

function toPcm16(sample) {
    return Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
}

function resolveFfmpegPath() {
    const configured = process.env.FFMPEG_PATH?.trim();
    if (configured) return configured;
    const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const bundled = join(
        repositoryRoot,
        "native",
        "video",
        "dist",
        `${process.platform}-${process.arch}`,
        executable,
    );
    return existsSync(bundled) ? bundled : "ffmpeg";
}

function encodeMp3(pcm, outputPath) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            resolveFfmpegPath(),
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "s16le",
                "-ar",
                String(SAMPLE_RATE),
                "-ac",
                String(CHANNELS),
                "-i",
                "pipe:0",
                "-map_metadata",
                "-1",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "192k",
                outputPath,
            ],
            { stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
        );
        const errors = [];
        child.stderr.on("data", (chunk) => errors.push(chunk));
        child.once("error", reject);
        child.once("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(
                Buffer.concat(errors).toString("utf8").trim() ||
                `FFmpeg MP3 encoder exited with code ${code}`,
            ));
        });
        child.stdin.end(pcm);
    });
}
