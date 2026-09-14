import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  createMemoryRunId,
  resolveMemoryLogPath,
} from "../src/demo/memoryLogPaths.ts";

const NOW = new Date("2026-09-14T12:05:30.123Z");

test("portable memory logs are unique by backend, process, and restart", () => {
  const first = resolveMemoryLogPath({
    backend: "webgpu",
    defaultPath: "logs/memoryInfo.log",
    now: NOW,
    pid: 12345,
    restart: 0,
    unique: true,
  });
  const second = resolveMemoryLogPath({
    backend: "webgpu",
    defaultPath: "logs/memoryInfo.log",
    now: NOW,
    pid: 54321,
    restart: 1,
    unique: true,
  });

  assert.equal(
    first,
    resolve("logs/memoryInfo-webgpu-20260914T120530123Z-p12345-r0.log"),
  );
  assert.equal(
    second,
    resolve("logs/memoryInfo-webgpu-20260914T120530123Z-p54321-r1.log"),
  );
  assert.notEqual(first, second);
});

test("portable memory logs suffix a configured path without overwriting it", () => {
  const path = resolveMemoryLogPath({
    backend: "webgl",
    configuredPath: "custom/session.jsonl",
    defaultPath: "logs/memoryInfo.log",
    now: NOW,
    pid: 77,
    unique: true,
  });

  assert.equal(
    path,
    resolve("custom/session-webgl-20260914T120530123Z-p77-r0.jsonl"),
  );
});

test("development memory log stays fixed when unique mode is disabled", () => {
  assert.equal(
    resolveMemoryLogPath({
      backend: "webgpu",
      configuredPath: "logs/development.log",
      defaultPath: "logs/memoryInfo.log",
      unique: false,
    }),
    resolve("logs/development.log"),
  );
  assert.match(
    createMemoryRunId({ now: NOW, pid: 42 }),
    /^20260914T120530123Z-p42-r0$/u,
  );
});
