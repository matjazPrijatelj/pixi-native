import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const RESTART_EXIT_CODE = 75;
const backend = process.argv[2];
const uniqueMemoryLog = process.argv.includes("--unique-memory-log");
if (backend !== "webgpu" && backend !== "webgl" && backend !== "webgl7") {
  throw new Error(
    "Choose `webgpu`, `webgl`, or `webgl7` as the demo backend argument",
  );
}

if (existsSync(".env")) process.loadEnvFile(".env");

let restartIndex = 0;

const startApp = (): void => {
  const childEnvironment = {
    ...process.env,
    ...(uniqueMemoryLog
      ? {
          PIXI_NATIVE_UNIQUE_MEMORY_LOG: "1",
          PIXI_NATIVE_MEMORY_LOG_BACKEND: backend,
          PIXI_NATIVE_MEMORY_LOG_RESTART: String(restartIndex),
        }
      : {}),
  };
  restartIndex++;
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
      env: childEnvironment,
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
