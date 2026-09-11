import Fs from "node:fs";
import Path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import C from "./util/common.js";

// Incremental builds must receive the same patches as a fresh Dawn checkout.
// Refuse conflicting local edits rather than resetting the user's checkout.
export function applyDawnPatches() {
    const patchDirectory = Path.join(C.dir.root, "patches");
    const patches = Fs.readdirSync(patchDirectory)
        .filter((name) => name.endsWith(".patch"))
        .sort();
    for (const name of patches) {
        const patch = Path.join(patchDirectory, name);
        const args = [
            ...C.gitConfigArgs,
            "apply",
            "--recount",
            "--ignore-space-change",
            "--ignore-whitespace",
        ];
        const options = { cwd: C.dir.dawn, encoding: "utf8" };
        if (
            spawnSync("git", [...args, "--reverse", "--check", patch], options)
                .status === 0
        )
            continue;
        const check = spawnSync("git", [...args, "--check", patch], options);
        if (check.status !== 0) {
            throw new Error(
                `Dawn patch ${name} conflicts with the local checkout; preserve and reconcile local changes first.\n${check.stderr ?? check.error ?? ""}`,
            );
        }
        console.log("applying Dawn patch", name);
        execFileSync("git", [...args, patch], {
            cwd: C.dir.dawn,
            stdio: "inherit",
        });
    }
}
