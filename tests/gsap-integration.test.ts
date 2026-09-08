import test from "node:test";
import { execFileSync } from "node:child_process";

for (const packageName of ["@pixi-native/pixi7", "@pixi-native/pixi8"]) {
  test(`GSAP PixiPlugin registers against ${packageName}`, () => {
    const script = [
      `import * as PIXI from ${JSON.stringify(packageName)};`,
      'import { gsap } from "gsap";',
      'import { PixiPlugin } from "gsap/PixiPlugin";',
      "PixiPlugin.registerPIXI(PIXI);",
      "gsap.registerPlugin(PixiPlugin);",
      'if (!gsap.plugins.pixi) throw new Error("PixiPlugin was not registered");',
      "gsap.ticker.sleep();",
    ].join("\n");

    execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    });
  });
}
