import { Container } from "pixi.js";
import { createMetricBitmapText } from "../bitmapFonts.ts";

export function createParticleTest(): Container {
    const scene = new Container();
    scene.addChild(
        createMetricBitmapText(
            "PARTICLE EMITTER TEST  [9]  |  global overlay  |  TAB toggle",
            24,
        ),
    );
    return scene;
}


