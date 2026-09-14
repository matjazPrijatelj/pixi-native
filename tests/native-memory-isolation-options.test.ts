import assert from "node:assert/strict";
import test from "node:test";
import {
    resolveIsolationBackends,
    resolveIsolationEntrypoint,
} from "../scripts/native-memory-isolation-options.mjs";

test("memory isolation resolves all supported renderers", () => {
    assert.deepEqual(resolveIsolationBackends("all"), [
        "webgl",
        "webgpu",
        "webgl7",
    ]);
    assert.deepEqual(resolveIsolationBackends("both"), ["webgl", "webgpu"]);
    assert.throws(() => resolveIsolationBackends("canvas"), /--backend=all/u);
});

test("webgl7 isolation uses the PixiJS 7 demo entrypoint", () => {
    assert.equal(resolveIsolationEntrypoint("webgl7"), "src/demo/v7/main.ts");
    assert.equal(resolveIsolationEntrypoint("webgpu"), "src/demo/v8/main.ts");
});
