export type RgbaUploadFormat =
    | "rgba8unorm"
    | "rgba8unorm-srgb"
    | "bgra8unorm"
    | "bgra8unorm-srgb";

/** Converts RGBA pixels to the destination layout and optionally premultiplies alpha. */
export function prepareRgbaPixelsForUpload(
    source: Uint8Array | Uint8ClampedArray,
    format: RgbaUploadFormat,
    premultiplyAlpha: boolean,
): Uint8Array {
    if (source.byteLength % 4 !== 0) {
        throw new Error(
            `RGBA pixel data has ${source.byteLength} bytes; expected a multiple of 4`,
        );
    }

    const swapRedAndBlue =
        format === "bgra8unorm" || format === "bgra8unorm-srgb";

    if (!swapRedAndBlue && !premultiplyAlpha) {
        return new Uint8Array(
            source.buffer,
            source.byteOffset,
            source.byteLength,
        );
    }

    const destination = new Uint8Array(source.byteLength);

    if (!premultiplyAlpha && source.byteOffset % 4 === 0) {
        const sourceWords = new Uint32Array(
            source.buffer,
            source.byteOffset,
            source.byteLength / 4,
        );
        const destinationWords = new Uint32Array(destination.buffer);

        for (let index = 0; index < sourceWords.length; index++) {
            const pixel = sourceWords[index];
            destinationWords[index] =
                (pixel & 0xff00ff00) |
                ((pixel & 0x000000ff) << 16) |
                ((pixel & 0x00ff0000) >>> 16);
        }

        return destination;
    }

    for (let offset = 0; offset < source.byteLength; offset += 4) {
        const alpha = source[offset + 3];
        const alphaScale = premultiplyAlpha ? alpha / 255 : 1;
        const red = Math.round(source[offset] * alphaScale);
        const green = Math.round(source[offset + 1] * alphaScale);
        const blue = Math.round(source[offset + 2] * alphaScale);

        destination[offset] = swapRedAndBlue ? blue : red;
        destination[offset + 1] = green;
        destination[offset + 2] = swapRedAndBlue ? red : blue;
        destination[offset + 3] = alpha;
    }

    return destination;
}
