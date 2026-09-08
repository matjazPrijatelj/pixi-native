import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GUARD_PATH = fileURLToPath(
  new URL("../scripts/reject-workspace-pack.mjs", import.meta.url),
);
const EXPECTED_MESSAGE =
  "This is a private development workspace. Use: pnpm run pack:dist";

test("workspace prepack guard rejects accidental root packaging", () => {
  const result = spawnSync(process.execPath, [GUARD_PATH], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), EXPECTED_MESSAGE);
});
