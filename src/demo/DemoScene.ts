import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";

export function createDemoScene(): Container {
    const scene = new Container();
    const rectangle = new Graphics().rect(80, 90, 220, 120).fill(0xe35d6a);
    const rounded = new Graphics().roundRect(360, 90, 220, 120, 24).fill(0x4f8cff);
    const circle = new Graphics().circle(760, 150, 70).fill(0x38d39f);
    const line = new Graphics().moveTo(80, 300).lineTo(900, 300).stroke({ width: 6, color: 0xf5c451 });
    const label = new Text({
        text: "PixiJS 8.20 + Electrobun Native WGPU",
        style: { fontFamily: "Arial", fontSize: 28, fill: 0xffffff, stroke: { color: 0x000000, width: 3 }, align: "center" }
    });
    label.anchor.set(0.5);
    label.position.set(640, 610);

    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 96;
    sprite.height = 96;
    sprite.tint = 0xff7b54;
    sprite.position.set(600, 360);
    sprite.anchor.set(0.5);
    scene.addChild(rectangle, rounded, circle, line, sprite, label);
    
    return scene;
}

export function animateDemoScene(scene: Container, deltaMS: number): void {
    const rectangle = scene.children[0];
    const sprite = scene.children[4];
    rectangle.rotation += deltaMS * 0.001;
    sprite.x = 600 + Math.sin(performance.now() / 500) * 220;
    sprite.y = 360 + Math.cos(performance.now() / 700) * 80;
}
