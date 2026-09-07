export type RgbaUploadFormat = "rgba8unorm" | "rgba8unorm-srgb" | "bgra8unorm" | "bgra8unorm-srgb";
/** Copies top-down RGBA rows from a bottom-up native image buffer. */
export declare function copyRgbaRowsFlippedY(target: Uint8Array | Uint8ClampedArray, source: Uint8Array | Uint8ClampedArray, width: number, height: number): void;
/** Converts RGBA pixels to the destination layout and optionally premultiplies alpha. */
export declare function prepareRgbaPixelsForUpload(source: Uint8Array | Uint8ClampedArray, format: RgbaUploadFormat, premultiplyAlpha: boolean, reusableDestination?: Uint8Array): Uint8Array;
/** Returns one bounded staging allocation for each encountered pixel-buffer size. */
export declare function getReusableUploadBuffer(buffers: Map<number, Uint8Array>, byteLength: number): Uint8Array;
