import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Assets, BitmapFont, BitmapText, settings } from "pixi.js-v7";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import {
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
  loadExternalBitmapFont,
} from "../src/demo/v7/bitmapFonts.ts";

test("PixiJS 7 dynamic BitmapFont contains every scene glyph", () => {
  new NodeDOMAdapter({} as never).installPixi7(settings);
  installDynamicBitmapTextFont();

  const sample = "[1] Dynamic atlas: ČŠŽ čšž € 0123456789";
  const font = BitmapFont.available[DYNAMIC_BITMAP_FONT_NAME];
  const missing = [...sample]
    .filter((character) => !font.chars[character.codePointAt(0) ?? -1])
    .join("");

  assert.equal(missing, "");
  assert.ok(
    new BitmapText(sample, {
      fontName: DYNAMIC_BITMAP_FONT_NAME,
      fontSize: 46,
    }).width > 0,
  );

  BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
});

test("PixiJS 7 Assets loads a native PNG without explicit Assets initialization", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  adapter.installPixi7(settings);
  (globalThis as unknown as { location?: Location }).location ??= new URL(
    "file:///",
  ) as unknown as Location;
  const path = fileURLToPath(
    new URL("../src/demo/assets/drum-kit.png", import.meta.url),
  );
  try {
    const texture = await Assets.load(path);
    assert.ok(texture.width > 1);
    assert.ok(texture.height > 1);
  } finally {
    await Assets.unload(path);
    adapter.dispose();
  }
});

test("PixiJS 7 loads the external bitmap font atlas from a file URL", async () => {
  const adapter = new NodeDOMAdapter({} as never);
  adapter.installPixi7(settings);
  const fontPath = fileURLToPath(
    new URL("../src/demo/assets/bitmap-font/native-pixel.fnt", import.meta.url),
  );

  try {
    await loadExternalBitmapFont(fontPath);
    assert.ok(BitmapFont.available.NativePixel);
  } finally {
    BitmapFont.uninstall("NativePixel");
    adapter.dispose();
  }
});
