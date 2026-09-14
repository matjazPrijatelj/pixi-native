export type IsolationBackend = "webgl" | "webgpu" | "webgl7";

export function resolveIsolationBackends(
    requestedBackend: string,
): IsolationBackend[];

export function resolveIsolationEntrypoint(backend: IsolationBackend): string;
