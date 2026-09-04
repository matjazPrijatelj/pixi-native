import { Container, Text } from "pixi.js";

const TEXT_RESOLUTION = 2;

export function createTextTest(): Container {
  const scene = new Container();
  scene.addChild(
    new Text({
      text: "TEXT TEST  [3]",
      resolution: TEXT_RESOLUTION,
      style: {
        fontFamily: "Arial",
        fontSize: 26,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 2 },
      },
    }),
  );

  const title = new Text({
    text: "Native Pixi Text",
    resolution: TEXT_RESOLUTION,
    style: {
      fontFamily: "Arial",
      fontSize: 54,
      fill: 0x6ee7ff,
      stroke: { color: 0x102030, width: 2 },
      align: "center",
    },
  });
  title.anchor.set(0.5);
  title.position.set(640, 150);

  const outlined = new Text({
    text: "Thin outline — readable",
    resolution: TEXT_RESOLUTION,
    style: {
      fontFamily: "Arial",
      fontSize: 38,
      fill: 0xffffff,
      stroke: { color: 0xe35d6a, width: 3 },
      align: "center",
    },
  });
  outlined.anchor.set(0.5);
  outlined.position.set(640, 250);

  const small = new Text({
    text: "Small 18px amber text",
    resolution: TEXT_RESOLUTION,
    style: {
      fontFamily: "Arial",
      fontSize: 18,
      fill: 0xf5c451,
      stroke: { color: 0x301f05, width: 1 },
    },
  });
  small.position.set(120, 390);

  const green = new Text({
    text: "Large green text",
    resolution: TEXT_RESOLUTION,
    style: {
      fontFamily: "Arial",
      fontSize: 46,
      fill: 0x38d39f,
      stroke: { color: 0x0b3025, width: 2 },
    },
  });
  green.position.set(120, 440);

  const noStroke = new Text({
    text: "Plain text without outline",
    resolution: TEXT_RESOLUTION,
    style: { fontFamily: "Arial", fontSize: 30, fill: 0xffffff },
  });
  noStroke.position.set(120, 520);

  scene.addChild(title, outlined, small, green, noStroke);
  return scene;
}


