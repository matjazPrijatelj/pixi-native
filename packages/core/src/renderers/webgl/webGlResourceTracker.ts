type WebGlResource = object;

interface ResourceDefinition {
    readonly label: string;
    readonly create: string;
    readonly remove: string;
}

const RESOURCE_DEFINITIONS: readonly ResourceDefinition[] = [
    { label: "Buffers", create: "createBuffer", remove: "deleteBuffer" },
    { label: "Textures", create: "createTexture", remove: "deleteTexture" },
    {
        label: "Framebuffers",
        create: "createFramebuffer",
        remove: "deleteFramebuffer",
    },
    {
        label: "Renderbuffers",
        create: "createRenderbuffer",
        remove: "deleteRenderbuffer",
    },
    { label: "Programs", create: "createProgram", remove: "deleteProgram" },
    { label: "Shaders", create: "createShader", remove: "deleteShader" },
    {
        label: "VertexArrays",
        create: "createVertexArray",
        remove: "deleteVertexArray",
    },
];

interface ResourceState {
    readonly definition: ResourceDefinition;
    readonly live: Set<WebGlResource>;
    created: number;
    deleted: number;
    peak: number;
}

export type WebGlResourceStats = Record<string, number>;

export interface WebGlResourceTracker {
    getStats(): WebGlResourceStats;
}

export interface PixiNativeResourceStatsTarget {
    __pixiNativeResourceStats?: () => Record<string, number>;
}

type MutableWebGlContext = WebGL2RenderingContext & Record<string, unknown>;

/** Tracks JavaScript-visible WebGL object lifetimes without retaining deleted resources. */
export function installWebGlResourceTracker(
    context: WebGL2RenderingContext,
): WebGlResourceTracker {
    const mutableContext = context as MutableWebGlContext;
    const states = RESOURCE_DEFINITIONS.map<ResourceState>((definition) => ({
        definition,
        live: new Set(),
        created: 0,
        deleted: 0,
        peak: 0,
    }));
    const boundBuffers = new Map<number, WebGlResource | null>();
    const bufferBytes = new Map<WebGlResource, number>();
    let liveBufferBytes = 0;
    let peakBufferBytes = 0;

    for (const state of states) {
        const create = getMethod(mutableContext, state.definition.create);
        const remove = getMethod(mutableContext, state.definition.remove);
        defineMethod(mutableContext, state.definition.create, (...args) => {
            const resource = create(...args) as WebGlResource | null;
            if (resource && !state.live.has(resource)) {
                state.live.add(resource);
                state.created++;
                state.peak = Math.max(state.peak, state.live.size);
            }
            return resource;
        });
        defineMethod(mutableContext, state.definition.remove, (...args) => {
            const resource = args[0] as WebGlResource | null | undefined;
            const result = remove(...args);
            if (resource && state.live.delete(resource)) {
                state.deleted++;
                if (state.definition.label === "Buffers") {
                    liveBufferBytes -= bufferBytes.get(resource) ?? 0;
                    bufferBytes.delete(resource);
                    for (const [target, bound] of boundBuffers) {
                        if (bound === resource) boundBuffers.set(target, null);
                    }
                }
            }
            return result;
        });
    }

    const bindBuffer = getMethod(mutableContext, "bindBuffer");
    defineMethod(mutableContext, "bindBuffer", (...args) => {
        const result = bindBuffer(...args);
        boundBuffers.set(
            args[0] as number,
            (args[1] as WebGlResource | null | undefined) ?? null,
        );
        return result;
    });

    const bufferData = getMethod(mutableContext, "bufferData");
    defineMethod(mutableContext, "bufferData", (...args) => {
        const result = bufferData(...args);
        const buffer = boundBuffers.get(args[0] as number);
        if (buffer) {
            const previousBytes = bufferBytes.get(buffer) ?? 0;
            const nextBytes = bufferDataByteLength(args);
            bufferBytes.set(buffer, nextBytes);
            liveBufferBytes += nextBytes - previousBytes;
            peakBufferBytes = Math.max(peakBufferBytes, liveBufferBytes);
        }
        return result;
    });

    return {
        getStats: () => {
            const stats: WebGlResourceStats = {
                webglBufferBytesLive: liveBufferBytes,
                webglBufferBytesPeak: peakBufferBytes,
            };
            for (const state of states) {
                const prefix = `webgl${state.definition.label}`;
                stats[`${prefix}Created`] = state.created;
                stats[`${prefix}Deleted`] = state.deleted;
                stats[`${prefix}Live`] = state.live.size;
                stats[`${prefix}Peak`] = state.peak;
            }
            return stats;
        },
    };
}

/** Exposes WebGL counters through the same internal hook as WebGPU diagnostics. */
export function attachWebGlResourceStats(
    target: object,
    getStats: () => WebGlResourceStats,
): void {
    Object.defineProperty(target, "__pixiNativeResourceStats", {
        configurable: true,
        value: getStats,
    });
}

function getMethod(
    context: MutableWebGlContext,
    name: string,
): (...args: unknown[]) => unknown {
    const method = context[name];
    if (typeof method !== "function") {
        throw new TypeError(`WebGL resource tracker requires ${name}()`);
    }
    return method.bind(context) as (...args: unknown[]) => unknown;
}

function defineMethod(
    context: MutableWebGlContext,
    name: string,
    method: (...args: unknown[]) => unknown,
): void {
    Object.defineProperty(context, name, {
        configurable: true,
        writable: true,
        value: method,
    });
}

function bufferDataByteLength(args: readonly unknown[]): number {
    const data = args[1];
    if (typeof data === "number") return Math.max(0, data);
    if (data === null || data === undefined) return 0;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (!ArrayBuffer.isView(data)) return 0;

    const bytesPerElement =
        "BYTES_PER_ELEMENT" in data &&
        typeof data.BYTES_PER_ELEMENT === "number"
            ? data.BYTES_PER_ELEMENT
            : 1;
    const availableElements = data.byteLength / bytesPerElement;
    const sourceOffset = Math.max(0, Number(args[3]) || 0);
    const requestedLength = Number(args[4]);
    const elementLength = Number.isFinite(requestedLength)
        ? Math.max(0, Math.min(requestedLength, availableElements - sourceOffset))
        : Math.max(0, availableElements - sourceOffset);
    return elementLength * bytesPerElement;
}
