import assert from "node:assert/strict";
import test from "node:test";
import { formatPnpmWorkspaceSettings } from "../scripts/pnpm-workspace-settings.mjs";

test("temporary pnpm workspaces use editable block-style YAML", () => {
  const settings = formatPnpmWorkspaceSettings(
    {
      "@matjash/pixi-native": "file:C:/temp/p.tgz",
    },
    ["pixi.js@8.21.0"],
  );

  assert.equal(
    settings,
    [
      "allowBuilds:",
      '  "native-gles": true',
      "overrides:",
      '  "@matjash/pixi-native": "file:C:/temp/p.tgz"',
      "minimumReleaseAgeExclude:",
      '  - "pixi.js@8.21.0"',
      "",
    ].join("\n"),
  );
});
