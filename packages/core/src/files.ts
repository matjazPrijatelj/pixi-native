import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path, module-relative path, or `file:` URL accepted by file helpers. */
export type FileSource = string | URL;

/** Read-only filesystem operations resolved relative to one ES module. */
export type ModuleFileAccess = Readonly<{
  /** Resolves a source to an absolute filesystem path without reading it. */
  resolvePath(source: FileSource): string;
  /** Returns `false` only when the resolved path does not exist. */
  exists(source: FileSource): Promise<boolean>;
  /** Reads the complete file as bytes. */
  readBytes(source: FileSource): Promise<Uint8Array>;
  /** Reads the complete file as text, using UTF-8 by default. */
  readText(source: FileSource, encoding?: BufferEncoding): Promise<string>;
  /** Reads and parses a JSON file as `T`, reporting its resolved path on errors. */
  readJson<T = unknown>(source: FileSource): Promise<T>;
}>;

const NETWORK_URL_PATTERN = /^https?:/i;

function toFilePath(source: FileSource): string {
  if (source instanceof URL) {
    if (source.protocol !== "file:") {
      throw new TypeError(`Expected a file URL, received ${source.href}`);
    }
    return fileURLToPath(source);
  }
  if (isAbsolute(source)) return source;
  if (source.startsWith("file:")) return fileURLToPath(source);
  if (NETWORK_URL_PATTERN.test(source)) {
    throw new TypeError(`Expected a filesystem path, received ${source}`);
  }
  return source;
}

/**
 * Creates read-only filesystem helpers whose relative paths follow an ES module.
 *
 * @param moduleUrl Usually the caller's `import.meta.url`.
 * @throws {TypeError} When `moduleUrl` or a source uses a non-file URL.
 */
export function createModuleFileAccess(
  moduleUrl: string | URL,
): ModuleFileAccess {
  const moduleFilePath = toFilePath(
    moduleUrl instanceof URL ? moduleUrl : new URL(moduleUrl),
  );
  const moduleDirectory = dirname(moduleFilePath);
  const resolvePath = (source: FileSource): string => {
    const filePath = toFilePath(source);
    return isAbsolute(filePath) ? filePath : resolve(moduleDirectory, filePath);
  };

  return {
    resolvePath,
    async exists(source: FileSource): Promise<boolean> {
      try {
        await access(resolvePath(source));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async readBytes(source: FileSource): Promise<Uint8Array> {
      return readFile(resolvePath(source));
    },
    async readText(
      source: FileSource,
      encoding: BufferEncoding = "utf8",
    ): Promise<string> {
      return readFile(resolvePath(source), { encoding });
    },
    async readJson<T = unknown>(source: FileSource): Promise<T> {
      const filePath = resolvePath(source);
      try {
        return JSON.parse(await readFile(filePath, "utf8")) as T;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new SyntaxError(
          `Failed to parse JSON file ${filePath}: ${error.message}`,
          { cause: error },
        );
      }
    },
  };
}
