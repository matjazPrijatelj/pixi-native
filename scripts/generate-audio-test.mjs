import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const DURATION_SECONDS = 6;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const DATA_BYTES = FRAME_COUNT * CHANNELS * 2;
const outputDirectory = fileURLToPath(new URL("../assets/audio/", import.meta.url));

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
