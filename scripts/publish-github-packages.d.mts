export interface ArchiveDigests {
  readonly shasum: string;
  readonly integrity: string;
}

export interface RegistryDistribution {
  readonly shasum?: string;
  readonly integrity?: string;
}

export interface NpmInvocation {
  readonly command: string;
  readonly argumentPrefix: readonly string[];
}

export interface ReleaseConfiguration {
  readonly version: string;
  readonly tag: string;
  readonly expectedPackages: readonly string[];
}

export function getReleaseConfiguration(
  useGenerator: boolean,
  runtimePackageVersion: string,
  generatorPackageVersion: string,
): ReleaseConfiguration;

export function getNpmInvocation(
  platform?: NodeJS.Platform,
  execPath?: string,
): NpmInvocation;

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
