import test from "node:test";
import assert from "node:assert/strict";
import { dispatchPixi7ModalFrame } from "../packages/pixi7/src/createPixiRenderer.ts";

test("Pixi 7 modal frames advance the shared ticker before listeners and rendering", () => {
  const order: string[] = [];
  const timestamps: number[] = [];
  const ticker = {
    started: true,
    update(timestamp: number): void {
      order.push("ticker");
      timestamps.push(timestamp);
    },
  };
  const listeners = new Set([() => order.push("listener")]);

  dispatchPixi7ModalFrame(125.5, ticker, listeners, (timestamp) => {
    order.push("render");
    timestamps.push(timestamp);
  });

  assert.deepEqual(order, ["ticker", "listener", "render"]);
  assert.deepEqual(timestamps, [125.5, 125.5]);
});

test("Pixi 7 modal frames leave a stopped shared ticker paused", () => {
  let updates = 0;

  dispatchPixi7ModalFrame(
    125.5,
    {
      started: false,
      update: () => updates++,
    },
    new Set(),
    () => undefined,
  );

  assert.equal(updates, 0);
});
