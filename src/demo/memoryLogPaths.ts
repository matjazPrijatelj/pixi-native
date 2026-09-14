import { extname, parse, resolve } from "node:path";

export interface UniqueMemoryLogOptions {
    readonly backend: string;
    readonly configuredPath?: string;
    readonly defaultPath: string;
    readonly now?: Date;
    readonly pid?: number;
    readonly restart?: number;
    readonly unique?: boolean;
}

/** Resolves the fixed development log or a collision-safe portable instance log. */
export function resolveMemoryLogPath(options: UniqueMemoryLogOptions): string {
    const basePath = resolve(options.configuredPath ?? options.defaultPath);
    if (!options.unique) return basePath;

    const parsed = parse(basePath);
    const extension = extname(basePath) || ".log";
    const baseName = parsed.name || "memoryInfo";
    const suffix = createMemoryRunId({
        backend: options.backend,
        now: options.now,
        pid: options.pid,
        restart: options.restart,
    });
    return resolve(parsed.dir, `${baseName}-${suffix}${extension}`);
}

export interface MemoryRunIdOptions {
    readonly backend?: string;
    readonly now?: Date;
    readonly pid?: number;
    readonly restart?: number;
}

/** Produces a filesystem-safe id shared by instance logs and portable soak runs. */
export function createMemoryRunId(options: MemoryRunIdOptions = {}): string {
    const timestamp = (options.now ?? new Date())
        .toISOString()
        .replaceAll(/[-:.]/gu, "");
    const backend = options.backend
        ? `${sanitizeSegment(options.backend)}-`
        : "";
    const pid = options.pid ?? process.pid;
    const restart = options.restart ?? 0;
    return `${backend}${timestamp}-p${pid}-r${restart}`;
}

function sanitizeSegment(value: string): string {
    return value.replaceAll(/[^a-z0-9_-]/giu, "-");
}
