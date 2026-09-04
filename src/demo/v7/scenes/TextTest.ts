import { Container, Text } from "pixi.js-v7";
export function createTextTest(): Container { const scene = new Container(); scene.addChild(new Text("TEXT TEST  [3]", { fontFamily: "Arial", fontSize: 26, fill: 0xffffff })); const values = [["Native Pixi Text", 54, 0x6ee7ff, 640, 150], ["Thin outline - readable", 38, 0xe35d6a, 640, 250], ["Small 18px amber text", 18, 0xf5c451, 120, 390], ["Large green text", 46, 0x38d39f, 120, 440], ["Plain text without outline", 30, 0xffffff, 120, 520]] as const; for (const [value, size, fill, x, y] of values) { const text = new Text(value, { fontFamily: "Arial", fontSize: size, fill }); text.position.set(x, y); scene.addChild(text); } return scene; }


