import Fs from "fs";
import Path from "path";
import { execFileSync } from "child_process";
import C from "./util/common.js";

console.log("build in", C.dir.build);
execFileSync(C.dir.ninja, ["-C", C.dir.build, "pixi_native_gpu.node", "-v"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...C.depotTools.env,
  },
});

console.log("copy to", C.dir.dist);
await Fs.promises.rm(C.dir.dist, { recursive: true }).catch(() => {});
await Fs.promises.mkdir(C.dir.dist, { recursive: true });
const packageDist = Path.join(
  C.dir.root,
  "..",
  "..",
  "packages",
  `native-${C.platform}-${C.targetArch}`,
  "native",
  "gpu",
  "dist",
  `${C.platform}-${C.targetArch}`,
);
await Fs.promises.mkdir(packageDist, { recursive: true });
const nativeBinary = Path.join(C.dir.dist, "pixi_native_gpu.node");
await Fs.promises.cp(
  Path.join(C.dir.build, "pixi_native_gpu.node"),
  nativeBinary,
);

if (C.platform === "win32") {
  await Fs.promises.cp(
    Path.join(C.dir.build, "d3dcompiler_47.dll"),
    Path.join(C.dir.dist, "d3dcompiler_47.dll"),
  );
}

// Strip binaries on linux
if (C.platform === "linux") {
  execFileSync("strip", ["-s", Path.join(C.dir.dist, "pixi_native_gpu.node")]);
}

await Fs.promises.cp(
  nativeBinary,
  Path.join(packageDist, "pixi_native_gpu.node"),
);
