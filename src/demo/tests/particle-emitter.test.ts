import test from "node:test";
import assert from "node:assert/strict";
import { Texture } from "pixi.js";
import { ParticleEmitter } from "../ParticleEmitter.ts";

test("particle emitter is disabled by default and stays bounded while recycling", () => {
    const texture = Texture.WHITE;
    const emitter = new ParticleEmitter(texture, { width: 800, height: 600 }, {
        random: () => 0.5,
    });

    assert.equal(emitter.enabled, false);
    assert.equal(emitter.particleCount, 0);
    emitter.update(1000);
    assert.equal(emitter.particleCount, 0);

    emitter.setEnabled(true);
    emitter.update(1000);
    assert.ok(emitter.particleCount > 0);
    assert.ok(emitter.particleCount <= 180);
    emitter.update(5000);
    assert.ok(emitter.particleCount <= 180);

    emitter.setEnabled(false);
    assert.equal(emitter.particleCount, 0);
    emitter.destroy();
});
