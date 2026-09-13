import assert from "node:assert/strict";
import test from "node:test";
import { createWebGpuBindGroupCacheController } from
    "../packages/pixi8/src/renderers/webgpu/webGpuBindGroupCache.ts";
import { shouldResetWebGpuBindGroupCache } from
    "../packages/pixi8/src/renderers/webgpu/webGpuBindGroupCache.ts";

test("WebGPU bind-group reset is opt-in", () => {
    assert.equal(shouldResetWebGpuBindGroupCache({}), false);
    assert.equal(shouldResetWebGpuBindGroupCache({
        PIXI_NATIVE_WEBGPU_BIND_GROUP_CACHE_RESET: "0",
    }), false);
    assert.equal(shouldResetWebGpuBindGroupCache({
        PIXI_NATIVE_WEBGPU_BIND_GROUP_CACHE_RESET: "1",
    }), true);
});

test("WebGPU bind-group cache remains intact below its limit", () => {
    const hash = { first: {}, second: null };
    const renderer = { bindGroup: { _hash: hash } };
    const controller = createWebGpuBindGroupCacheController(renderer, 2);

    assert.equal(controller.afterRender(), false);
    assert.equal(renderer.bindGroup._hash, hash);
    assert.equal(controller.getStats().gpuBindGroups, 1);
});

test("WebGPU bind-group cache resets at its limit", () => {
    const renderer = { bindGroup: { _hash: { first: {}, second: {} } } };
    const controller = createWebGpuBindGroupCacheController(renderer, 2);

    assert.equal(controller.afterRender(), true);
    assert.equal(Object.keys(renderer.bindGroup._hash).length, 0);
    assert.equal(controller.getStats().gpuBindGroupCacheResets, 1);
});

test("controller is a no-op when WebGPU bind groups are unavailable", () => {
    const controller = createWebGpuBindGroupCacheController({}, 2);
    assert.equal(controller.afterRender(), false);
    assert.deepEqual(controller.getStats(), {
        gpuBindGroups: 0,
        gpuTextureBindGroups: 0,
        gpuManagedTextures: 0,
        gpuManagedBuffers: 0,
        gpuBindGroupCacheResets: 0,
    });
});

test("cache resets after managed WebGPU resources are released", () => {
    const textures: Record<string, unknown> = { first: {}, second: {} };
    const renderer = {
        bindGroup: { _hash: { first: {} } },
        texture: { _managedTextures: { items: textures } },
        buffer: { _managedBuffers: { items: { first: {} } } },
    };
    const controller = createWebGpuBindGroupCacheController(renderer, 20);

    assert.equal(controller.afterRender(), false);
    textures.second = null;
    assert.equal(controller.afterRender(), true);
    assert.equal(controller.getStats().gpuBindGroups, 0);
    assert.equal(controller.getStats().gpuBindGroupCacheResets, 1);
});
