import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const NETWORK_URL_PATTERN = /^https?:/i;
function toFilePath(source) {
    if (source instanceof URL) {
        if (source.protocol !== "file:") {
            throw new TypeError(`Expected a file URL, received ${source.href}`);
        }
        return fileURLToPath(source);
    }
    if (isAbsolute(source))
        return source;
    if (source.startsWith("file:"))
        return fileURLToPath(source);
    if (NETWORK_URL_PATTERN.test(source)) {
        throw new TypeError(`Expected a filesystem path, received ${source}`);
    }
    return source;
}
/** Creates filesystem helpers whose relative paths follow an ES module. */
export function createModuleFileAccess(moduleUrl) {
    const moduleFilePath = toFilePath(moduleUrl instanceof URL ? moduleUrl : new URL(moduleUrl));
    const moduleDirectory = dirname(moduleFilePath);
    const resolvePath = (source) => {
        const filePath = toFilePath(source);
        return isAbsolute(filePath) ? filePath : resolve(moduleDirectory, filePath);
    };
    return {
        resolvePath,
        async exists(source) {
            try {
                await access(resolvePath(source));
                return true;
            }
            catch (error) {
                if (error.code === "ENOENT")
                    return false;
                throw error;
            }
        },
        async readBytes(source) {
            return readFile(resolvePath(source));
        },
        async readText(source, encoding = "utf8") {
            return readFile(resolvePath(source), { encoding });
        },
        async readJson(source) {
            const filePath = resolvePath(source);
            try {
                return JSON.parse(await readFile(filePath, "utf8"));
            }
            catch (error) {
                if (!(error instanceof SyntaxError))
                    throw error;
                throw new SyntaxError(`Failed to parse JSON file ${filePath}: ${error.message}`, { cause: error });
            }
        },
    };
}
