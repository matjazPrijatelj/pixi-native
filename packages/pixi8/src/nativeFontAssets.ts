import {
    DOMAdapter,
    ExtensionType,
    LoaderParserPriority,
    extensions,
    getFontFamilyName,
    loadWebFont,
    type LoaderParser,
} from "pixi.js";
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
    id: "web-font",
    fallback: loadWebFont as NativeFontLoaderParser,
    fetch: (url) => DOMAdapter.get().fetch(url),
    getFontFamilyName,
});

/** Replaces Pixi 8's FontFace loader with the native Canvas font loader. */
export function installNativeFontAssets(): void {
    extensions.remove(loadWebFont);
    extensions.add(nativeFontLoader as LoaderParser);
}

export { nativeFontLoader };
