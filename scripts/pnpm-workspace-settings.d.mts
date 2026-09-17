export function formatPnpmWorkspaceSettings(
  overrides: Readonly<Record<string, string>>,
  minimumReleaseAgeExclude?: readonly string[],
): string;

export function writePnpmWorkspaceSettings(
  directory: string,
  overrides: Readonly<Record<string, string>>,
  minimumReleaseAgeExclude?: readonly string[],
): Promise<void>;
