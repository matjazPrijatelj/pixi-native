import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const RESTART_EXIT_CODE = 75;
const backend = process.argv[2];
if (backend !== "webgpu" && backend !== "webgl" && backend !== "webgl7") {
  throw new Error(
    "Choose `webgpu`, `webgl`, or `webgl7` as the demo backend argument",
  );
}

if (existsSync(".env")) process.loadEnvFile(".env");

const startApp = (): void => {
  const child = spawn(
    process.execPath,
    [
      "--expose-gc",
      "--enable-source-maps",
      backend === "webgl7" ? "src/demo/v7/main.ts" : "src/demo/v8/main.ts",
      backend,
    ],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    },
  );

  child.on("exit", (code) => {
    if (code === RESTART_EXIT_CODE) {
      console.log("Restarting app...");
      startApp();
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error("Failed to start app:", error);
    process.exit(1);
  });
};

startApp();
