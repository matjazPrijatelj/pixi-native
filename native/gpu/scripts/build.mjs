import Fs from "fs";
import Path from "path";
import C from "./util/common.js";
import { removeDirectory } from "./util/remove-directory.mjs";
import { initializeWindowsDevEnvironment } from "./windows-dev-environment.mjs";

initializeWindowsDevEnvironment();
await import("./preflight.mjs");

const cleanBuild = process.env.DAWN_CLEAN_BUILD === "1";
if (cleanBuild) {
  await Promise.all(
    [C.dir.depotTools, C.dir.dawn, C.dir.build, C.dir.dist, C.dir.publish].map(
      async (dir) => {
        console.log("Removing:", dir);
        await removeDirectory(dir);
      },
    ),
  );
} else {
  console.log(
    "incremental Dawn build (set DAWN_CLEAN_BUILD=1 for a clean rebuild)",
  );
}
console.log("Downloading depot tools...");
await import("./download-depot-tools.mjs");
if (cleanBuild || !Fs.existsSync(Path.join(C.dir.dawn, ".git"))) {
  await import("./download-dawn.mjs");
} else {
  console.log("reuse existing Dawn checkout", C.dir.dawn);
}
await import("./configure.mjs");
await import("./make.mjs");
