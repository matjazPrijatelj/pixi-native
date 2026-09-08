import { BitmapText, Container, Graphics } from "pixi.js-v7";
import { createMetricBitmapText } from "./bitmapFonts.ts";

/** Always-visible FPS indicator for the Pixi 7 native WebGL demo. */
export class FpsOverlay7 extends Container {
  private readonly textLabel: BitmapText;
  private elapsedMS = 0;
  private squaredElapsedMS = 0;
  private frameCount = 0;
  private nextUpdateMS = 100;

  public constructor() {
    super();
    this.textLabel = createMetricBitmapText("FPS: --", 18);
    const background = new Graphics();
    background
      .beginFill(0x101522, 0.85)
      .drawRoundedRect(0, 0, 360, 32, 6)
      .endFill();
    this.textLabel.position.set(10, 6);
    this.addChild(background, this.textLabel);
    this.position.set(12, 12);
  }

  public alignRight(viewportWidth: number): void {
    this.position.x = Math.max(12, viewportWidth - this.width - 12);
    this.position.y = 12;
  }

  public tick(deltaMS: number): void {
    this.elapsedMS += deltaMS;
    this.squaredElapsedMS += deltaMS * deltaMS;
    this.frameCount++;
    this.nextUpdateMS -= deltaMS;
    if (this.nextUpdateMS > 0) return;
    const fps =
      this.elapsedMS > 0 ? (this.frameCount * 1000) / this.elapsedMS : 0;
    const averageFrameMS = this.elapsedMS / this.frameCount;
    const variance = Math.max(
      0,
      this.squaredElapsedMS / this.frameCount - averageFrameMS ** 2,
    );
    this.textLabel.text = `FPS ${fps.toFixed(1)} | ${averageFrameMS.toFixed(1)} ms | jitter ${Math.sqrt(variance).toFixed(1)}`;
    this.elapsedMS = 0;
    this.squaredElapsedMS = 0;
    this.frameCount = 0;
    this.nextUpdateMS = 1000;
  }
}
