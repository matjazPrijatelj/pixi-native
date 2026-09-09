import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const NON_SOURCE_FILE = /\.(?:dll|exe|gz|jpeg|jpg|mp3|mp4|node|png|tgz|wav)$/i;

/** Hashes Git-normalized source and release metadata without generated artifacts. */
export function computeSourceFingerprint(repositoryRoot) {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (path) =>
        path &&
        !path.startsWith("artifacts/") &&
        !NON_SOURCE_FILE.test(path) &&
        existsSync(resolve(repositoryRoot, path)),
    )
    .sort();
  const entries = paths.map((path) => {
    const blob = execFileSync(
      "git",
      ["hash-object", `--path=${path}`, "--", path],
      { cwd: repositoryRoot, encoding: "utf8" },
    ).trim();
    return `${blob} ${path}`;
  });
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}
