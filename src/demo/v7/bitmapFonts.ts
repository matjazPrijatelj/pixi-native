import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BitmapFont, BitmapText, Texture } from "pixi.js-v7";

export const DYNAMIC_BITMAP_FONT_NAME = "NativeDynamicBitmap";
export const EXTERNAL_BITMAP_FONT_NAME = "NativePixel";

let dynamicInstalled = false;

export function installDynamicBitmapTextFont(): void {
    if (dynamicInstalled) return;
    const characters: [string[], string] = [[" ", "~"], "ČŠŽčšž€"];
    BitmapFont.from(DYNAMIC_BITMAP_FONT_NAME, {
        fontFamily: "Arial", fontSize: 48, fill: 0xffffff, padding: 4,
    }, { chars: characters });
    dynamicInstalled = true;
}

/** Registers the checked-in BMFont without invoking Pixi 7 format detection. */
export async function loadExternalBitmapFont(path: string): Promise<void> {
    if (BitmapFont.available[EXTERNAL_BITMAP_FONT_NAME]) return;
    const descriptor = await readFile(path, "utf8");
    const data = parseBitmapFontDescriptor(descriptor);
    const texturePath = join(dirname(path), data.pages[0].file);
    const texture = Texture.from(texturePath);
    BitmapFont.install(descriptor as never, [texture] as never);
}

export function createMetricBitmapText(text: string, fontSize: number): BitmapText {
    return new BitmapText(text, { fontName: DYNAMIC_BITMAP_FONT_NAME, fontSize, tint: 0xffffff });
}

export function destroyBitmapFonts(): void {
    BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
    BitmapFont.uninstall(EXTERNAL_BITMAP_FONT_NAME);
    dynamicInstalled = false;
}

interface BitmapFontDescriptor {
    readonly info: { readonly face: string; readonly size: number };
    readonly common: { readonly lineHeight: number; readonly base: number; readonly scaleW: number; readonly scaleH: number; readonly pages: number; readonly packed: number };
    readonly pages: Array<{ readonly id: number; readonly file: string }>;
    readonly chars: Array<Record<string, number>>;
    readonly kernings: Array<Record<string, number>>;
}

const ATTRIBUTE_PATTERN = /(\w+)=(["'][^"']*["']|[^\s]+)/gu;

function parseBitmapFontDescriptor(source: string): BitmapFontDescriptor {
    const lines = source.split(/\r?\n/u).filter((line) => line.length > 0);
    const records = lines.map((line) => {
        const firstSpace = line.indexOf(" ");
        const type = firstSpace < 0 ? line : line.slice(0, firstSpace);
        const attributes: Record<string, string | number> = {};
        for (const match of line.matchAll(ATTRIBUTE_PATTERN)) {
            const value = match[2].replace(/^["']|["']$/gu, "");
            attributes[match[1]] = /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : value;
        }
        return { type, attributes };
    });
    const find = (type: string): Record<string, string | number> => records.find((record) => record.type === type)?.attributes ?? {};
    const info = find("info");
    const common = find("common");
    const pages = records.filter((record) => record.type === "page").map(({ attributes }) => ({ id: Number(attributes.id), file: String(attributes.file) }));
    const chars = records.filter((record) => record.type === "char").map(({ attributes }) => attributes as Record<string, number>);
    const kernings = records.filter((record) => record.type === "kerning").map(({ attributes }) => attributes as Record<string, number>);
    return {
        info: { face: String(info.face), size: Number(info.size) },
        common: { lineHeight: Number(common.lineHeight), base: Number(common.base), scaleW: Number(common.scaleW), scaleH: Number(common.scaleH), pages: Number(common.pages), packed: Number(common.packed) },
        pages, chars, kernings,
    };
}
