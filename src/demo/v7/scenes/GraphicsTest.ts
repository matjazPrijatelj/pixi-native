import { Container, Graphics, Text } from "pixi.js-v7";
export function createGraphicsTest(): Container & {
  update(deltaMS: number): void;
} {
  const scene = new Container() as Container & {
    update(deltaMS: number): void;
  };
  scene.addChild(
    new Text("GRAPHICS TEST  [1]  |  9 animated primitives", {
      fontFamily: "Arial",
      fontSize: 26,
      fill: 0xffffff,
    }),
  );
  const shapes: Graphics[] = [];
  const add = (draw: (g: Graphics) => void, x: number, y: number): void => {
    const g = new Graphics();
    draw(g);
    g.position.set(x, y);
    scene.addChild(g);
    shapes.push(g);
  };
  add(
    (g) => g.beginFill(0xe35d6a).drawRect(-90, -45, 180, 90).endFill(),
    220,
    175,
  );
  add(
    (g) =>
      g.beginFill(0x4f8cff).drawRoundedRect(-90, -45, 180, 90, 24).endFill(),
    640,
    175,
  );
  add((g) => g.beginFill(0x38d39f).drawCircle(0, 0, 55).endFill(), 1060, 175);
  add(
    (g) =>
      g
        .lineStyle(7, 0xf5c451)
        .moveTo(-90, 30)
        .lineTo(-30, -35)
        .lineTo(30, 35)
        .lineTo(90, -30),
    220,
    365,
  );
  add(
    (g) => g.beginFill(0xb56cff).drawEllipse(0, 0, 85, 48).endFill(),
    640,
    365,
  );
  add(
    (g) =>
      g.beginFill(0xff8c42).drawPolygon([-75, 55, 0, -65, 75, 55]).endFill(),
    1060,
    365,
  );
  add(
    (g) =>
      g
        .beginFill(0xf45b9a)
        .drawPolygon([
          -62, 0, -24, -18, -19, -62, 0, -28, 19, -62, 24, -18, 62, 0, 24, 18,
          19, 62, 0, 28, -19, 62, -24, 18,
        ])
        .endFill(),
    220,
    555,
  );
  add((g) => g.lineStyle(14, 0x4dd8e8).drawCircle(0, 0, 58), 640, 555);
  add(
    (g) =>
      g
        .lineStyle(9, 0xa8e063)
        .moveTo(-85, 35)
        .bezierCurveTo(-35, -75, 35, 75, 85, -35),
    1060,
    555,
  );
  scene.update = (deltaMS) => {
    for (let i = 0; i < shapes.length; i++)
      shapes[i].rotation += deltaMS * 0.0002 * (i % 2 ? -1 : 1);
  };
  return scene;
}
