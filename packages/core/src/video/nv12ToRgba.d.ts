import type { NativeVideoFrame } from "./NativeVideo.ts";
/** Converts one limited-range BT.709 NV12 frame for the Pixi 7 CPU bridge. */
export declare function convertNv12ToRgba(frame: NativeVideoFrame, output?: Uint8Array<ArrayBuffer>): Uint8Array;
