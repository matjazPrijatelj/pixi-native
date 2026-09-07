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

const INTEGER_TOLERANCE = 1e-6;

/** Resolves a chroma-aligned left-color/right-alpha split for one NV12 frame. */
export function getPackedAlphaVideoLayout(
    frameWidth: number,
    frameHeight: number,
    alphaMaskScale: number,
): PackedAlphaVideoLayout {
    if (
        !Number.isSafeInteger(frameWidth) ||
        !Number.isSafeInteger(frameHeight) ||
        frameWidth <= 0 ||
        frameHeight <= 0 ||
        frameWidth % 2 !== 0 ||
        frameHeight % 2 !== 0
    ) {
        throw new RangeError(
            "packed alpha NV12 frame dimensions must be positive even integers",
        );
    }
    if (!Number.isFinite(alphaMaskScale) || alphaMaskScale <= 0) {
        throw new RangeError("alphaMaskScale must be positive and finite");
    }

    const exactColorWidth = frameWidth / (1 + alphaMaskScale);
    const colorWidth = Math.round(exactColorWidth);
    const alphaWidth = frameWidth - colorWidth;
    if (Math.abs(exactColorWidth - colorWidth) > INTEGER_TOLERANCE) {
        throw new RangeError(
            "alphaMaskScale must split the decoded frame into whole pixel widths",
        );
    }
    if (
        colorWidth <= 0 ||
        alphaWidth <= 0 ||
        colorWidth % 2 !== 0 ||
        alphaWidth % 2 !== 0
    ) {
        throw new RangeError(
            "packed alpha color and mask widths must be positive even numbers",
        );
    }

    return {
        frameWidth,
        frameHeight,
        colorWidth,
        alphaWidth,
        colorFraction: colorWidth / frameWidth,
        yTexelX: 1 / frameWidth,
        yTexelY: 1 / frameHeight,
        uvTexelX: 2 / frameWidth,
        uvTexelY: 2 / frameHeight,
    };
}

