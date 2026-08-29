import { Container, Sprite, Text, Texture } from "pixi.js";

export function createSpriteTest(texture: Texture): Container {
    const scene = new Container();
    scene.addChild(new Text({ text: "SPRITE TEST  [2]", style: { fontFamily: "Arial", fontSize: 26, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } }));
    const controlSprite = new Sprite(Texture.WHITE);
    controlSprite.width = 80;
    controlSprite.height = 80;
    controlSprite.tint = 0x00ff66;
    controlSprite.position.set(1100, 120);
    controlSprite.zIndex = 9;
    const sprite = new Sprite(texture);
    sprite.width = 360;
    sprite.height = 360;
    sprite.anchor.set(0.5);
    sprite.position.set(640, 390);
    sprite.tint = 0xffffff;
    sprite.zIndex = 10;
    scene.addChild(controlSprite, sprite);
    return scene;
}
