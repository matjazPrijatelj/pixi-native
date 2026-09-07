export interface VideoSpriteOptions {
    /** Width of the right alpha strip divided by the width of the left color image. */
    readonly alphaMaskScale?: number;
}
export interface PackedAlphaVideoLayout {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly colorWidth: number;
    readonly alphaWidth: number;
    readonly colorFraction: number;
    readonly yTexelX: number;
    readonly yTexelY: number;
    readonly uvTexelX: number;
    readonly uvTexelY: number;
}
/** Resolves a chroma-aligned left-color/right-alpha split for one NV12 frame. */
export declare function getPackedAlphaVideoLayout(frameWidth: number, frameHeight: number, alphaMaskScale: number): PackedAlphaVideoLayout;
