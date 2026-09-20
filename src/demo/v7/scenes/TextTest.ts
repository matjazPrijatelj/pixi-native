import { Container, Text } from "pixi.js-v7";

export const OTF_DEMO_FONT_FAMILY = "Source Sans 3 Demo";

export function createTextTest(): Container {
  const scene = new Container();
  scene.addChild(
    new Text("TEXT TEST  [3]", {
      fontFamily: "Arial",
      fontSize: 26,
      fill: 0xffffff,
    }),
  );
  const values = [
    [
      "OTF Source Sans 3 — ČŠŽ 012345",
      OTF_DEMO_FONT_FAMILY,
      52,
      0x6ee7ff,
      120,
      130,
    ],
    ["Arial comparison — ČŠŽ 012345", "Arial", 40, 0xffffff, 120, 220],
    ["Small 18px amber text", "Arial", 18, 0xf5c451, 120, 340],
    ["Large green text", "Arial", 46, 0x38d39f, 120, 410],
    ["Plain text without outline", "Arial", 30, 0xffffff, 120, 500],
  ] as const;
  for (const [value, fontFamily, size, fill, x, y] of values) {
    const text = new Text(value, { fontFamily, fontSize: size, fill });
    text.position.set(x, y);
    scene.addChild(text);
  }
  return scene;
}
