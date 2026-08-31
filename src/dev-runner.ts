import { spawn } from "node:child_process";

const RESTART_EXIT_CODE = 75;

const startApp = (): void => {
  const child = spawn(
    process.execPath,
    ["--enable-source-maps", "src/main.ts"],
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
