const BACKEND_GROUPS = Object.freeze({
    all: ["webgl", "webgpu", "webgl7"],
    both: ["webgl", "webgpu"],
});

const SINGLE_BACKENDS = new Set(["webgl", "webgpu", "webgl7"]);

export function resolveIsolationBackends(requestedBackend) {
    if (requestedBackend in BACKEND_GROUPS) {
        return [...BACKEND_GROUPS[requestedBackend]];
    }
    if (SINGLE_BACKENDS.has(requestedBackend)) return [requestedBackend];
    throw new Error(
        "Use --backend=webgl, --backend=webgpu, --backend=webgl7, --backend=both, or --backend=all",
    );
}

export function resolveIsolationEntrypoint(backend) {
    return backend === "webgl7" ? "src/demo/v7/main.ts" : "src/demo/v8/main.ts";
}
