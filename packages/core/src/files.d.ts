export type FileSource = string | URL;
export type ModuleFileAccess = Readonly<{
    resolvePath(source: FileSource): string;
    exists(source: FileSource): Promise<boolean>;
    readBytes(source: FileSource): Promise<Uint8Array>;
    readText(source: FileSource, encoding?: BufferEncoding): Promise<string>;
    readJson<T = unknown>(source: FileSource): Promise<T>;
}>;
/** Creates filesystem helpers whose relative paths follow an ES module. */
export declare function createModuleFileAccess(moduleUrl: string | URL): ModuleFileAccess;
