import { GlobalFonts, type FontKey } from "@napi-rs/canvas";

const NATIVE_FONT_EXTENSION_PATTERN = /\.(?:otf|ttf)(?:$|[?#])/i;
const NATIVE_FONT_DATA_URL_PATTERN = /^data:font\/(?:otf|ttf)(?:[;,])/i;

export interface NativeFontRegistration {
    readonly kind: "native-font";
    readonly family: string;
    readonly key: FontKey;
}

export interface NativeFontRegistry {
    register(font: Buffer, nameAlias?: string): FontKey | null;
    remove(key: FontKey): boolean;
}

export interface NativeFontResolvedAsset {
    readonly data?: {
        readonly family?: string;
    };
    readonly format?: string;
    readonly [key: string]: unknown;
}

interface FontLoaderParser {
    readonly test?: (
        url: string,
        asset?: NativeFontResolvedAsset,
        loader?: unknown,
    ) => boolean;
    readonly load?: (
        url: string,
        asset?: NativeFontResolvedAsset,
        loader?: unknown,
    ) => Promise<unknown>;
    readonly unload?: (
        asset: unknown,
        resolvedAsset?: NativeFontResolvedAsset,
        loader?: unknown,
    ) => void | Promise<void>;
}

export interface NativeFontLoaderParser extends FontLoaderParser {
    readonly extension: unknown;
    readonly name: string;
    readonly id?: string;
}

export interface NativeFontLoaderOptions {
    readonly extension: unknown;
    readonly name: string;
    readonly id?: string;
    readonly fallback: FontLoaderParser;
    readonly fetch: (url: string) => Promise<Response>;
    readonly getFontFamilyName: (url: string) => string;
    readonly registry?: NativeFontRegistry;
}

/** Returns whether Pixi resolved the asset as an OpenType or TrueType font. */
export function isNativeCanvasFont(
    url: string,
    asset?: NativeFontResolvedAsset,
): boolean {
    const format = asset?.format?.replace(/^\./, "").toLowerCase();
    return (
        format === "otf" ||
        format === "ttf" ||
        NATIVE_FONT_EXTENSION_PATTERN.test(url) ||
        NATIVE_FONT_DATA_URL_PATTERN.test(url)
    );
}

export function isNativeFontRegistration(
    value: unknown,
): value is NativeFontRegistration {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as { kind?: unknown }).kind === "native-font"
    );
}

/** Creates a Pixi-compatible font parser backed by native Canvas GlobalFonts. */
export function createNativeFontLoader(
    options: NativeFontLoaderOptions,
): NativeFontLoaderParser {
    const registry = options.registry ?? GlobalFonts;
    return {
        extension: options.extension,
        name: options.name,
        id: options.id,
        test: (url, asset, loader) =>
            options.fallback.test?.(url, asset, loader) ?? false,
        load: async (url, asset, loader) => {
            if (!isNativeCanvasFont(url, asset)) {
                if (!options.fallback.load) {
                    throw new Error(`No fallback font loader is available for ${url}`);
                }
                return options.fallback.load(url, asset, loader);
            }

            const response = await options.fetch(url);
            if (!response.ok) {
                throw new Error(
                    `Failed to fetch native font ${url}: ${response.status} ${response.statusText}`,
                );
            }
            const family = asset?.data?.family ?? options.getFontFamilyName(url);
            const bytes = Buffer.from(await response.arrayBuffer());
            const key = registry.register(bytes, family);
            if (!key) {
                throw new Error(
                    `Native Canvas failed to register font family "${family}" from ${url}`,
                );
            }
            return { kind: "native-font", family, key } satisfies NativeFontRegistration;
        },
        unload: async (asset, resolvedAsset, loader) => {
            if (isNativeFontRegistration(asset)) {
                registry.remove(asset.key);
                return;
            }
            await options.fallback.unload?.(asset, resolvedAsset, loader);
        },
    };
}
