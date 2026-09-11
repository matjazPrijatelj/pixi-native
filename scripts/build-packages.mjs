import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");
const packageNames = ["core", "pixi7", "pixi8", "create-pixi-native"];

for (const packageName of packageNames) {
  const packageRoot = resolve(root, "packages", packageName);
  await rm(resolve(packageRoot, "dist"), { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: packageRoot,
    stdio: "inherit",
  });
}

if (
  (process.platform === "win32" || process.platform === "linux") &&
  process.arch === "x64"
) {
  execFileSync(
    process.execPath,
    [resolve(root, "scripts/stage-native-package.mjs")],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}
