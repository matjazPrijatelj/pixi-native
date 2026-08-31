import { Container, Graphics, Text } from "pixi.js";

/** Always-visible FPS indicator rendered by Pixi on the native WebGPU surface. */
export class FpsOverlay extends Container {
  private readonly textLabel: Text;
  private elapsedMS = 0;
  private squaredElapsedMS = 0;
  private frameCount = 0;
  private nextUpdateMS = 1000;

  public constructor() {
    super();
    this.textLabel = new Text({
      text: "FPS: --",
      resolution: 2,
      style: { fontFamily: "Arial", fontSize: 18, fill: 0xffffff },
    });

    const background = new Graphics()
      .roundRect(0, 0, 250, 32, 6)
      .fill({ color: 0x101522, alpha: 0.85 });

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
    const jitterMS = Math.sqrt(variance);
    this.textLabel.text =
      `FPS ${fps.toFixed(1)} | ${averageFrameMS.toFixed(1)} ms` +
      ` | jitter ${jitterMS.toFixed(1)}`;
    this.elapsedMS = 0;
    this.squaredElapsedMS = 0;
    this.frameCount = 0;
    this.nextUpdateMS = 1000;
  }
}
