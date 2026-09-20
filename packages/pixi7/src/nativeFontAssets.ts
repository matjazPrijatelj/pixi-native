import {
    ExtensionType,
    LoaderParserPriority,
    extensions,
    getFontFamilyName,
    loadWebFont,
    settings,
    type LoaderParser,
} from "pixi.js-v7";
import {
    createNativeFontLoader,
    type NativeFontLoaderParser,
} from "@pixi-native/core/canvas/NativeFontAssets.js";

const nativeFontLoader = createNativeFontLoader({
    extension: {
        type: ExtensionType.LoadParser,
        priority: LoaderParserPriority.Low,
    },
    name: "loadWebFont",
    fallback: loadWebFont as NativeFontLoaderParser,
    fetch: (url) => settings.ADAPTER.fetch(url),
    getFontFamilyName,
});

/** Replaces Pixi 7's FontFace loader with the native Canvas font loader. */
export function installNativeFontAssets(): void {
    extensions.remove(loadWebFont);
    extensions.add(nativeFontLoader as LoaderParser);
}

export { nativeFontLoader };
