import { ParticleContainer, Sprite, Texture } from "pixi.js-v7";

const MAX_PARTICLES = 180;
const PARTICLES_PER_SECOND = 72;
const MIN_LIFETIME_MS = 900;
const MAX_LIFETIME_MS = 1800;

export interface ParticleEmitter7Bounds {
  readonly width: number;
  readonly height: number;
}
export interface ParticleEmitter7Options {
  readonly random?: () => number;
}

interface ParticleRecord {
  readonly particle: Sprite;
  ageMs: number;
  lifetimeMs: number;
  velocityX: number;
  velocityY: number;
  spin: number;
  active: boolean;
}

/** Bounded Pixi 7 particle system matching the Pixi 8 demo emitter. */
export class ParticleEmitter7 {
  public readonly container: ParticleContainer;
  private readonly texture: Texture;
  private readonly random: () => number;
  private readonly records: ParticleRecord[] = [];
  private bounds: ParticleEmitter7Bounds;
  private spawnRemainder = 0;
  private _enabled = false;
  private destroyed = false;

  public constructor(
    texture: Texture,
    initialBounds: ParticleEmitter7Bounds,
    options: ParticleEmitter7Options = {},
  ) {
    this.texture = texture;
    this.random = options.random ?? Math.random;
    this.bounds = normalizeBounds(initialBounds);
    this.container = new ParticleContainer(MAX_PARTICLES, {
      position: true,
      rotation: true,
      alpha: true,
    });
    this.container.visible = false;
  }

  public get enabled(): boolean {
    return this._enabled;
  }
  public get particleCount(): number {
    return this.container.children.length;
  }

  public setEnabled(enabled: boolean): void {
    if (this.destroyed || enabled === this._enabled) return;
    this._enabled = enabled;
    this.container.visible = enabled;
    this.spawnRemainder = 0;
    if (!enabled) for (const record of this.records) this.recycle(record);
  }

  public update(deltaMS: number): void {
    if (this.destroyed || !this._enabled) return;
    const elapsedMS = Math.max(0, Math.min(deltaMS, 100));
    this.spawnRemainder += (elapsedMS / 1000) * PARTICLES_PER_SECOND;
    while (this.spawnRemainder >= 1) {
      this.spawnRemainder--;
      this.spawn();
    }
    for (const record of this.records) {
      if (!record.active) continue;
      record.ageMs += elapsedMS;
      if (
        record.ageMs >= record.lifetimeMs ||
        record.particle.y > this.bounds.height + 24
      ) {
        this.recycle(record);
        continue;
      }
      const seconds = elapsedMS / 1000;
      record.particle.x += record.velocityX * seconds;
      record.particle.y += record.velocityY * seconds;
      record.velocityY += 180 * seconds;
      record.particle.rotation += record.spin * seconds;
      record.particle.alpha = Math.max(0, 1 - record.ageMs / record.lifetimeMs);
    }
  }

  public resize(width: number, height: number): void {
    this.bounds = normalizeBounds({ width, height });
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.setEnabled(false);
    this.destroyed = true;
    this.container.destroy({ children: true });
  }

  private spawn(): void {
    let record = this.records.find((candidate) => !candidate.active);
    if (!record && this.records.length < MAX_PARTICLES) {
      record = {
        particle: new Sprite(this.texture),
        ageMs: 0,
        lifetimeMs: 0,
        velocityX: 0,
        velocityY: 0,
        spin: 0,
        active: false,
      };
      record.particle.anchor.set(0.5);
      this.records.push(record);
    }
    if (!record) return;
    record.ageMs = 0;
    record.lifetimeMs = randomBetween(
      this.random,
      MIN_LIFETIME_MS,
      MAX_LIFETIME_MS,
    );
    record.velocityX = randomBetween(this.random, -75, 75);
    record.velocityY = randomBetween(this.random, 90, 240);
    record.spin = randomBetween(this.random, -2.5, 2.5);
    record.particle.position.set(
      randomBetween(this.random, 20, this.bounds.width - 20),
      -24,
    );
    const scale = randomBetween(this.random, 0.035, 0.075);
    record.particle.scale.set(scale);
    record.particle.rotation = 0;
    record.particle.alpha = 1;
    record.active = true;
    this.container.addChild(record.particle);
  }

  private recycle(record: ParticleRecord): void {
    if (!record.active) return;
    record.active = false;
    this.container.removeChild(record.particle);
  }
}

function normalizeBounds(
  bounds: ParticleEmitter7Bounds,
): ParticleEmitter7Bounds {
  return {
    width: Math.max(40, bounds.width),
    height: Math.max(40, bounds.height),
  };
}
function randomBetween(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  return minimum + random() * (maximum - minimum);
}
