import { Container, Graphics, Text } from "pixi.js";

export function createGraphicsTest(): Container {
    const scene = new Container();
    scene.addChild(new Text({ text: "GRAPHICS TEST  [1]", style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }));
    scene.addChild(new Graphics().rect(80, 130, 220, 120).fill(0xe35d6a));
    scene.addChild(new Graphics().roundRect(360, 130, 220, 120, 24).fill(0x4f8cff));
    scene.addChild(new Graphics().circle(760, 190, 70).fill(0x38d39f));
    scene.addChild(new Graphics().moveTo(80, 340).lineTo(1100, 340).stroke({ width: 6, color: 0xf5c451 }));
    return scene;
}
