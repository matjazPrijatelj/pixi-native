import { Container, Graphics, Text } from "pixi.js";

export function createGraphicsTest(): Container {
  const scene = new Container();
  scene.addChild(
    new Text({
      text: "GRAPHICS TEST  [1]",
      resolution: 2,
      style: {
        fontFamily: "Arial",
        fontSize: 26,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    }),
  );

  const gRect = new Graphics().rect(130, 200, 220, 120).fill(0xe35d6a);

  const gRoundedRect = new Graphics()
    .roundRect(500, 200, 220, 120, 24)
    .fill(0x4f8cff);

  const gCircle = new Graphics().circle(1000, 260, 70).fill(0x38d39f);

  const gLine = new Graphics()
    .moveTo(139, 400)
    .lineTo(1100, 340)
    .stroke({ width: 6, color: 0xf5c451 });

  scene.addChild(gRect, gRoundedRect, gCircle, gLine);

  return scene;
}
