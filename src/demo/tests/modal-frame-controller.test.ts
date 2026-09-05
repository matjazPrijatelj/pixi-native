import test from "node:test";
import assert from "node:assert/strict";
import { createModalFrameController } from "../../pixi-native/ModalFrameController.ts";

test("non-Windows renderers do not load the Win32 modal-frame addon", () => {
    const controller = createModalFrameController(
        new Uint8Array(),
        () => assert.fail("non-Windows modal frame callback must not run"),
        () => assert.fail("non-Windows modal state callback must not run"),
        "linux",
    );

    assert.doesNotThrow(() => controller.detach());
});
