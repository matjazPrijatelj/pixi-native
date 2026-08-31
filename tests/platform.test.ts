import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { getDefaultGpuBackend, resolveGpuBackend, supportsNativeVideo } from "../src/pixi-node/platform.ts";

const require = createRequire(import.meta.url);
const { getBindingPath, getPlatformDirectory } = require("../native/gpu/src/binding-path.js") as {
    getBindingPath(platform?: string, arch?: string): string;
    getPlatformDirectory(platform?: string, arch?: string): string;
};

test("native GPU backend defaults follow the host platform", () => {
    assert.equal(getDefaultGpuBackend("win32"), "d3d12");
    assert.equal(getDefaultGpuBackend("linux"), "vulkan");
    assert.equal(getDefaultGpuBackend("darwin"), "metal");
});

test("WGPU_BACKEND overrides the platform default", () => {
    assert.equal(resolveGpuBackend("win32", "vulkan"), "vulkan");
    assert.equal(resolveGpuBackend("win32", "  d3d12  "), "d3d12");
    assert.equal(resolveGpuBackend("linux", undefined), "vulkan");
});

test("native GPU binding paths are isolated by platform and architecture", () => {
    assert.equal(getPlatformDirectory("win32", "x64"), "win32-x64");
    assert.equal(getPlatformDirectory("linux", "x64"), "linux-x64");
    assert.equal(getBindingPath("win32", "x64").endsWith(path.join("dist", "win32-x64", "dawn.node")), true);
});

test("the VA-API video scene is exposed only on Linux", () => {
    assert.equal(supportsNativeVideo("linux"), true);
    assert.equal(supportsNativeVideo("win32"), false);
    assert.equal(supportsNativeVideo("darwin"), false);
});
