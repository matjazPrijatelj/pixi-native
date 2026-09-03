export type RgbaUploadFormat =
    | "rgba8unorm"
    | "rgba8unorm-srgb"
    | "bgra8unorm"
    | "bgra8unorm-srgb";

/** Copies top-down RGBA rows from a bottom-up native image buffer. */
export function copyRgbaRowsFlippedY(
    target: Uint8Array | Uint8ClampedArray,
    source: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
): void {
    const rowBytes = width * 4;
    const expectedBytes = rowBytes * height;
    if (
        width < 1 ||
        height < 1 ||
        source.byteLength !== expectedBytes ||
        target.byteLength !== expectedBytes
    ) {
        throw new Error(
            `RGBA image has invalid dimensions ${width}x${height} (${source.byteLength} bytes)`,
        );
    }

    for (let y = 0; y < height; y++) {
        const sourceOffset = (height - y - 1) * rowBytes;
        target.set(
            source.subarray(sourceOffset, sourceOffset + rowBytes),
            y * rowBytes,
        );
    }
}

/** Converts RGBA pixels to the destination layout and optionally premultiplies alpha. */
export function prepareRgbaPixelsForUpload(
    source: Uint8Array | Uint8ClampedArray,
    format: RgbaUploadFormat,
    premultiplyAlpha: boolean,
    reusableDestination?: Uint8Array,
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

    const destination = reusableDestination ?? new Uint8Array(source.byteLength);
    if (destination.byteLength !== source.byteLength) {
        throw new Error(
            `RGBA destination has ${destination.byteLength} bytes; expected ${source.byteLength}`,
        );
    }

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

/** Returns one bounded staging allocation for each encountered pixel-buffer size. */
export function getReusableUploadBuffer(
    buffers: Map<number, Uint8Array>,
    byteLength: number,
): Uint8Array {
    let buffer = buffers.get(byteLength);
    if (!buffer) {
        buffer = new Uint8Array(byteLength);
        buffers.set(byteLength, buffer);
    }
    return buffer;
}
