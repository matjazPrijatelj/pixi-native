import { Container, Graphics, Text } from "pixi.js";

interface AnimatedGraphic {
  readonly graphic: Graphics;
  readonly baseX: number;
  readonly baseY: number;
  readonly phase: number;
  readonly rotationSpeed: number;
}

interface GraphicsTestScene extends Container {
  update(deltaMS: number): void;
}

export function createGraphicsTest(): Container {
  const scene = new Container() as GraphicsTestScene;
  scene.addChild(
    new Text({
      text: "GRAPHICS TEST  [1]  |  9 animated primitives",
      resolution: 2,
      style: {
        fontFamily: "Arial",
        fontSize: 26,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    }),
  );

  const graphics = [
    new Graphics().rect(-90, -45, 180, 90).fill(0xe35d6a),
    new Graphics().roundRect(-90, -45, 180, 90, 24).fill(0x4f8cff),
    new Graphics().circle(0, 0, 55).fill(0x38d39f),
    new Graphics()
      .moveTo(-90, 30)
      .lineTo(-30, -35)
      .lineTo(30, 35)
      .lineTo(90, -30)
      .stroke({ width: 7, color: 0xf5c451 }),
    new Graphics().ellipse(0, 0, 85, 48).fill(0xb56cff),
    new Graphics().poly([-75, 55, 0, -65, 75, 55]).fill(0xff8c42),
    new Graphics().star(0, 0, 7, 62, 29).fill(0xf45b9a),
    new Graphics().circle(0, 0, 58).stroke({ width: 14, color: 0x4dd8e8 }),
    new Graphics()
      .moveTo(-85, 35)
      .bezierCurveTo(-35, -75, 35, 75, 85, -35)
      .stroke({ width: 9, color: 0xa8e063 }),
  ];

  const columns = [220, 640, 1060];
  const rows = [175, 365, 555];
  const animated: AnimatedGraphic[] = graphics.map((graphic, index) => ({
    graphic,
    baseX: columns[index % columns.length],
    baseY: rows[Math.floor(index / columns.length)],
    phase: index * 0.7,
    rotationSpeed: (index % 2 === 0 ? 1 : -1) * (0.25 + index * 0.035),
  }));

  for (const item of animated) {
    item.graphic.position.set(item.baseX, item.baseY);
  }
  scene.addChild(...graphics);

  let elapsedSeconds = 0;
  scene.update = (deltaMS: number): void => {
    elapsedSeconds += deltaMS / 1000;
    for (const item of animated) {
      const wave = elapsedSeconds + item.phase;
      item.graphic.x = item.baseX + Math.cos(wave * 1.15) * 24;
      item.graphic.y = item.baseY + Math.sin(wave * 1.6) * 16;
      item.graphic.rotation += deltaMS * 0.001 * item.rotationSpeed;
      const scale = 1 + Math.sin(wave * 1.9) * 0.1;
      item.graphic.scale.set(scale);
      item.graphic.alpha = 0.78 + (Math.cos(wave * 1.35) + 1) * 0.11;
    }
  };

  return scene;
}
