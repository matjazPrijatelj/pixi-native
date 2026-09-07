import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Assets, BitmapFont, BitmapText, settings } from "pixi.js-v7";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";
import {
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
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

test("PixiJS 7 Assets loader resolves real dimensions before scene setup", async () => {
  new NodeDOMAdapter({} as never).installPixi7(settings);
  Assets.detections.length = 0;
  await Assets.init({
    skipDetections: true,
    texturePreference: { format: ["png"] },
  });
  (globalThis as unknown as { location?: Location }).location ??= new URL(
    "file:///",
  ) as unknown as Location;
  const path = fileURLToPath(
    new URL("../src/demo/assets/drum-kit.png", import.meta.url),
  );
  const texture = await Assets.load(path);

  assert.ok(texture.width > 1);
  assert.ok(texture.height > 1);
  await Assets.unload(path);
});
