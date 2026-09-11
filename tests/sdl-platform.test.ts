import assert from "node:assert/strict";
import { test } from "node:test";
import { configureSdlPlatform } from "../packages/core/src/runtime/sdlPlatform.ts";

test("Linux selects X11 before SDL initialization, including Wayland sessions", () => {
    const environment: NodeJS.ProcessEnv = {
        DISPLAY: ":0",
        WAYLAND_DISPLAY: "wayland-0",
    };
    configureSdlPlatform("linux", environment);
    assert.equal(environment.SDL_VIDEODRIVER, "x11");
    assert.equal(environment.WAYLAND_DISPLAY, "wayland-0");
    configureSdlPlatform("linux", environment);
    assert.equal(environment.SDL_VIDEODRIVER, "x11");
});

test("Linux rejects incompatible native handles and missing XWayland", () => {
    assert.throws(
        () => configureSdlPlatform("linux", { WAYLAND_DISPLAY: "wayland-0" }),
        /DISPLAY is unavailable/,
    );
    assert.throws(
        () =>
            configureSdlPlatform("linux", {
                DISPLAY: ":0",
                SDL_VIDEODRIVER: "wayland",
            }),
        /SDL_VIDEODRIVER=x11/,
    );
});

test("Windows and explicit headless execution retain their platform settings", () => {
    const windows: NodeJS.ProcessEnv = {};
    configureSdlPlatform("win32", windows);
    assert.deepEqual(windows, {});
    const headless: NodeJS.ProcessEnv = {
        PIXI_NATIVE_HEADLESS: "1",
        SDL_VIDEODRIVER: "dummy",
    };
    configureSdlPlatform("linux", headless);
    assert.equal(headless.SDL_VIDEODRIVER, "dummy");
});
