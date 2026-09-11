import assert from "node:assert/strict";
import test from "node:test";

const enabled =
    process.platform === "linux" &&
    process.env.PIXI_NATIVE_TEST_TRANSPARENCY === "1";

test(
    "X11 transparent visuals are isolated per SDL window",
    { skip: !enabled },
    async () => {
        const { default: sdl } = await import(
            "../packages/core/src/runtime/sdl.ts"
        );
        for (const webgpu of [true, false]) {
            for (const transparent of [true, false, true]) {
                const window = sdl.video.createWindow({
                    title: "Pixi transparency visual test",
                    width: 64,
                    height: 64,
                    webgpu,
                    opengl: !webgpu,
                    transparent,
                });
                try {
                    assert.equal(
                        (window.native as unknown as { transparent: boolean })
                            .transparent,
                        transparent,
                    );
                } finally {
                    window.destroy();
                }
            }
        }
    },
);

test(
    "SDL EGL preserves alpha and presents after MSAA resize",
    { skip: !enabled },
    async () => {
        const { createNodeSdlWebGLSurface } = await import(
            "../packages/core/src/renderers/webgl/NodeSdlWebGLSurface.ts"
        );
        const { resolveNodeRendererOptions } = await import(
            "../packages/core/src/runtime/windowOptions.ts"
        );
        for (const antialiasSamples of [0, 4] as const) {
            const options = resolveNodeRendererOptions(
                {
                    width: 64,
                    height: 64,
                    transparent: true,
                    backgroundAlpha: 0.5,
                    antialiasSamples,
                },
                "Pixi EGL alpha test",
            );
            const surface = await createNodeSdlWebGLSurface(options, "test");
            try {
                assert.equal(surface.backgroundAlpha, 0.5);
                const gl = surface.webgl;
                for (const alpha of [0, 0.5, 1]) {
                    gl.clearColor(0.25 * alpha, 0, 0, alpha);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    if (antialiasSamples === 0) {
                        const pixel = new Uint8Array(4);
                        gl.readPixels(
                            0,
                            0,
                            1,
                            1,
                            gl.RGBA,
                            gl.UNSIGNED_BYTE,
                            pixel,
                        );
                        assert.ok(
                            Math.abs(pixel[3] - Math.round(alpha * 255)) <= 1,
                            `alpha=${alpha}, pixel=${pixel}`,
                        );
                    }
                    surface.renderer.swap();
                    assert.equal(gl.getError(), gl.NO_ERROR);
                }
            const nativeWindow = surface.window as unknown as {
                setSize(width: number, height: number): void;
            };
            nativeWindow.setSize(96, 80);
            surface.canvas.resize(surface.window.pixelWidth, surface.window.pixelHeight);
            assert.ok(surface.window.pixelWidth >= 96);
            assert.ok(surface.window.pixelHeight >= 80);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                surface.renderer.swap();
                assert.equal(gl.getError(), gl.NO_ERROR);
            } finally {
                surface.renderer.destroy();
                surface.window.destroy();
            }
        }
    },
);
