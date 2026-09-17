import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function formatPnpmWorkspaceSettings(
  overrides,
  minimumReleaseAgeExclude = [],
) {
  const lines = ["allowBuilds:", '  "native-gles": true', "overrides:"];

  for (const [packageName, version] of Object.entries(overrides)) {
    lines.push(`  ${JSON.stringify(packageName)}: ${JSON.stringify(version)}`);
  }

  if (minimumReleaseAgeExclude.length > 0) {
    lines.push("minimumReleaseAgeExclude:");
    for (const packageVersion of minimumReleaseAgeExclude) {
      lines.push(`  - ${JSON.stringify(packageVersion)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function writePnpmWorkspaceSettings(
  directory,
  overrides,
  minimumReleaseAgeExclude = [],
) {
  await writeFile(
    resolve(directory, "pnpm-workspace.yaml"),
    formatPnpmWorkspaceSettings(overrides, minimumReleaseAgeExclude),
  );
}
