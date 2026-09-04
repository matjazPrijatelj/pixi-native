import { BitmapFont, BitmapText } from "pixi.js";

export const DYNAMIC_BITMAP_FONT_NAME = "NativeDynamicBitmap";
export const EXTERNAL_BITMAP_FONT_NAME = "NativePixel";

export function installDynamicBitmapTextFont(): void {
    BitmapFont.install({
        name: DYNAMIC_BITMAP_FONT_NAME,
        style: {
            fontFamily: "Arial",
            fontSize: 48,
            fill: 0xffffff,
        },
        chars: [[" ", "~"], "ČŠŽčšž€"],
        resolution: 2,
        padding: 4,
        textureStyle: {
            scaleMode: "linear",
        },
    });
}

/** Creates frequently updated metric text without per-update Canvas rasterization. */
export function createMetricBitmapText(
    text: string,
    fontSize: number,
): BitmapText {
    return new BitmapText({
        text,
        style: {
            fontFamily: DYNAMIC_BITMAP_FONT_NAME,
            fontSize,
            fill: 0xffffff,
        },
    });
}


