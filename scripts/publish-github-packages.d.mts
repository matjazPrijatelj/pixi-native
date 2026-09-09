export interface ArchiveDigests {
  readonly shasum: string;
  readonly integrity: string;
}

export interface RegistryDistribution {
  readonly shasum?: string;
  readonly integrity?: string;
}

export function sanitizeNpmEnvironment(
  environment: NodeJS.ProcessEnv,
  userConfig: string,
  cache: string,
): NodeJS.ProcessEnv;

export function archiveDigests(bytes: Uint8Array): ArchiveDigests;

export function registryCopyMatches(
  localDigests: ArchiveDigests,
  registryDistribution: RegistryDistribution | null,
): boolean;
