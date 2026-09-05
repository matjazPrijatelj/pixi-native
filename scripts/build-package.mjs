import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const tsc = resolve(root, "node_modules", "typescript", "bin", "tsc");

await rm(output, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: root,
    stdio: "inherit",
});
