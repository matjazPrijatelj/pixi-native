import { BitmapText, Container, Text } from "pixi.js";
import {
  DYNAMIC_BITMAP_FONT_NAME,
  EXTERNAL_BITMAP_FONT_NAME,
} from "../bitmapFonts.ts";

export function createBitmapTextTest(): Container {
  const scene = new Container() as Container & {
    update(deltaMS: number, now: number): void;
  };
  scene.addChild(
    new Text({
      text: "BITMAP TEXT TEST  [4]",
      resolution: 2,
      style: {
        fontFamily: "Arial",
        fontSize: 26,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    }),
  );

  const dynamicTitle = new BitmapText({
    text: "[1] Dynamic atlas: ČŠŽ čšž € 0123456789",
    style: {
      fontFamily: DYNAMIC_BITMAP_FONT_NAME,
      fontSize: 46,
      fill: 0x6ee7ff,
      letterSpacing: 1,
    },
  });
  dynamicTitle.position.set(80, 115);

  const dynamicMultiline = new BitmapText({
    text: "[2] TINTED BITMAP TEXT\nONE ATLAS, TWO LINES",
    style: {
      fontFamily: DYNAMIC_BITMAP_FONT_NAME,
      fontSize: 36,
      fill: 0x38d39f,
      align: "center",
      lineHeight: 44,
    },
  });
  dynamicMultiline.anchor.set(0.5, 0);
  dynamicMultiline.position.set(640, 220);

  const externalTitle = new BitmapText({
    text: "[3] EXTERNAL FNT/PNG ATLAS",
    style: {
      fontFamily: EXTERNAL_BITMAP_FONT_NAME,
      fontSize: 56,
      fill: 0xf5c451,
      letterSpacing: 2,
    },
  });
  externalTitle.anchor.set(0.5);
  externalTitle.position.set(640, 430);

  const externalDetails = new BitmapText({
    text: "[4] NATIVE PIXEL 5X7 - 0123456789",
    style: {
      fontFamily: EXTERNAL_BITMAP_FONT_NAME,
      fontSize: 32,
      fill: 0xe35d6a,
    },
  });
  externalDetails.anchor.set(0.5);
  externalDetails.position.set(640, 530);

  scene.addChild(
    dynamicTitle,
    dynamicMultiline,
    externalTitle,
    externalDetails,
  );
  scene.update = (_deltaMS, now) => {
    externalTitle.rotation = Math.sin(now / 850) * 0.025;
    externalTitle.scale.set(1 + Math.sin(now / 600) * 0.04);
  };
  return scene;
}
