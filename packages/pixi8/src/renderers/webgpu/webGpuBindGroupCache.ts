const DEFAULT_MAX_BIND_GROUPS = 2_048;

type BindGroupHash = Record<string, unknown>;

interface WebGpuRendererInternals {
    bindGroup?: { _hash?: BindGroupHash };
    texture?: {
        _bindGroupHash?: BindGroupHash;
        _managedTextures?: { items?: Record<string, unknown> };
    };
    buffer?: { _managedBuffers?: { items?: Record<string, unknown> } };
}

export interface WebGpuResourceStats {
    readonly gpuBindGroups: number;
    readonly gpuTextureBindGroups: number;
    readonly gpuManagedTextures: number;
    readonly gpuManagedBuffers: number;
    readonly gpuBindGroupCacheResets: number;
}

export interface WebGpuBindGroupCacheController {
    afterRender(): boolean;
    getStats(): WebGpuResourceStats;
}

/** Enables the private Pixi cache workaround only for explicit diagnostics. */
export function shouldResetWebGpuBindGroupCache(
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    return environment.PIXI_NATIVE_WEBGPU_BIND_GROUP_CACHE_RESET === "1";
}

function countLiveEntries(hash: Record<string, unknown> | undefined): number {
    if (!hash) return 0;
    let count = 0;
    for (const value of Object.values(hash)) {
        if (value) count++;
    }
    return count;
}

/** Bounds Pixi's renderer-lifetime GPUBindGroup cache at a frame boundary. */
export function createWebGpuBindGroupCacheController(
    renderer: object,
    maxBindGroups = DEFAULT_MAX_BIND_GROUPS,
): WebGpuBindGroupCacheController {
    if (!Number.isInteger(maxBindGroups) || maxBindGroups <= 0) {
        throw new RangeError("WebGPU bind-group cache limit must be a positive integer");
    }
    const internals = renderer as WebGpuRendererInternals;
    let resets = 0;
    let previousManagedTextures = 0;
    let previousManagedBuffers = 0;

    const getStats = (): WebGpuResourceStats => ({
        gpuBindGroups: countLiveEntries(internals.bindGroup?._hash),
        gpuTextureBindGroups: countLiveEntries(internals.texture?._bindGroupHash),
        gpuManagedTextures: countLiveEntries(internals.texture?._managedTextures?.items),
        gpuManagedBuffers: countLiveEntries(internals.buffer?._managedBuffers?.items),
        gpuBindGroupCacheResets: resets,
    });

    return {
        afterRender(): boolean {
            const hash = internals.bindGroup?._hash;
            const managedTextures = countLiveEntries(
                internals.texture?._managedTextures?.items,
            );
            const managedBuffers = countLiveEntries(
                internals.buffer?._managedBuffers?.items,
            );
            const releasedResources =
                managedTextures < previousManagedTextures ||
                managedBuffers < previousManagedBuffers;
            previousManagedTextures = managedTextures;
            previousManagedBuffers = managedBuffers;
            if (
                !hash ||
                (!releasedResources && countLiveEntries(hash) < maxBindGroups)
            ) {
                return false;
            }
            internals.bindGroup!._hash = Object.create(null) as BindGroupHash;
            resets++;
            console.warn(
                `WebGPU bind-group cache reset after ${
                    releasedResources ? "resource release" : `${maxBindGroups} entries`
                } (reset ${resets})`,
            );
            return true;
        },
        getStats,
    };
}
