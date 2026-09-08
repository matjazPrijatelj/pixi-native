import Fs from "fs";
import Path from "path";
import { execFileSync } from "child_process";
import C from "./util/common.js";
import { removeDirectory } from "./util/remove-directory.mjs";

console.log("clone", C.dawn.url);
await removeDirectory(C.dir.dawn);
await Fs.promises.mkdir(C.dir.dawn, { recursive: true });
execFileSync("git", [...C.gitConfigArgs, "init"], {
  stdio: "inherit",
  cwd: C.dir.dawn,
});
execFileSync(
  "git",
  [...C.gitConfigArgs, "remote", "add", "origin", C.dawn.url],
  { stdio: "inherit", cwd: C.dir.dawn },
);
execFileSync(
  "git",
  [...C.gitConfigArgs, "fetch", "--depth", "1", "origin", C.dawn.commit],
  { stdio: "inherit", cwd: C.dir.dawn },
);
execFileSync("git", [...C.gitConfigArgs, "checkout", "FETCH_HEAD"], {
  stdio: "inherit",
  cwd: C.dir.dawn,
});

console.log("applying Dawn patches");
process.chdir(C.dir.dawn);
const patchDirectory = Path.join(C.dir.root, "patches");
const patchFiles = (await Fs.promises.readdir(patchDirectory))
  .filter((file) => file.endsWith(".patch"))
  .sort();

for (const patchFile of patchFiles) {
  console.log(`applying ${patchFile}`);
  execFileSync(
    "git",
    [
      ...C.gitConfigArgs,
      "apply",
      "--recount",
      "--ignore-space-change",
      "--ignore-whitespace",
      Path.join(patchDirectory, patchFile),
    ],
    {
      stdio: "inherit",
    },
  );
}
