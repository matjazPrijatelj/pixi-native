import { readFileSync, statSync } from "node:fs";

const GIT_LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

/** Returns whether a local path contains actual video bytes rather than an LFS pointer. */
export function isUsableVideoAsset(path: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size < 256) return false;
    const prefix = readFileSync(path).subarray(0, 64).toString("utf8");
    return !prefix.startsWith(GIT_LFS_POINTER_PREFIX);
  } catch {
    return false;
  }
}

export function filterVideoAssets<T extends { file: string }>(
  assets: readonly T[],
  resolvePath: (file: string) => string,
): T[] {
  const usable: T[] = [];
  for (const asset of assets) {
    const path = resolvePath(asset.file);
    if (isUsableVideoAsset(path)) {
      usable.push(asset);
      continue;
    }
    console.warn(
      `[pixi-native] skipping unavailable video asset ${asset.file}; run git lfs pull`,
    );
  }
  return usable;
}
