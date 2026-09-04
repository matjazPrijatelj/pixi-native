import type { NativeVideoFrame } from "./NativeVideo.ts";

/** Converts one limited-range BT.709 NV12 frame for the Pixi 7 CPU bridge. */
export function convertNv12ToRgba(frame: NativeVideoFrame, output = new Uint8Array(frame.width * frame.height * 4)): Uint8Array {
    for (let y = 0; y < frame.height; y++) {
        const yRow = y * frame.yStride;
        const uvRow = Math.floor(y / 2) * frame.uvStride;
        for (let x = 0; x < frame.width; x++) {
            const yValue = (frame.y[yRow + x] - 16) * (255 / 219);
            const uvIndex = uvRow + Math.floor(x / 2) * 2;
            const u = (frame.uv[uvIndex] - 128) * (255 / 224);
            const v = (frame.uv[uvIndex + 1] - 128) * (255 / 224);
            const offset = (y * frame.width + x) * 4;
            output[offset] = clampByte(yValue + 1.5748 * v);
            output[offset + 1] = clampByte(yValue - 0.1873 * u - 0.4681 * v);
            output[offset + 2] = clampByte(yValue + 1.8556 * u);
            output[offset + 3] = 255;
        }
    }
    return output;
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}
