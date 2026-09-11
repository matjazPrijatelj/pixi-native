import { createRequire } from "node:module";

import type { NodeSdl3Window } from "../../runtime/NativeWindow.ts";

const require = createRequire(import.meta.url);

/** Loads the GLES call table before SDL chooses its OpenGL ES driver. */
export function loadNativeGl(): Record<string, unknown> {
    return require("native-gles") as Record<string, unknown>;
}

export interface SdlWebGLContextResult {
    readonly gl: WebGL2RenderingContext & { canvas: unknown };
    readonly makeCurrent: () => boolean;
    readonly resize: (width: number, height: number) => boolean;
    readonly swapBuffers: () => boolean;
    readonly setSwapInterval: (interval: number) => boolean;
    readonly destroy: () => void;
}

/**
 * Wraps SDL3's OpenGL ES context in webgl-node's JavaScript WebGL2 facade.
 * native-gles supplies only the already-generated GLES call table; its EGL
 * context and surface ownership are deliberately not used.
 */
export async function createSdlWebGL2Context(
    window: NodeSdl3Window,
    nativeGl: Record<string, unknown>,
): Promise<SdlWebGLContextResult> {
    const { WebGL2RenderingContext } = await import("webgl-node");
    if (!window.makeGlCurrent()) {
        throw new Error("SDL3 could not make the OpenGL ES context current");
    }

    const context = new WebGL2RenderingContext(
        nativeGl,
        window.pixelWidth,
        window.pixelHeight,
        {},
    ) as WebGL2RenderingContext & {
        canvas: unknown;
        _width: number;
        _height: number;
        makeCurrent?: () => boolean;
    };
    const makeCurrent = (): boolean => window.makeGlCurrent();
    Object.defineProperty(context, "makeCurrent", {
        value: makeCurrent,
        writable: true,
        configurable: true,
        enumerable: false,
    });

    return {
        gl: context,
        makeCurrent,
        resize: (width, height) => {
            context._width = Math.max(1, width | 0);
            context._height = Math.max(1, height | 0);
            return true;
        },
        swapBuffers: () => window.swapGl(),
        setSwapInterval: (interval) => window.setGlSwapInterval(interval),
        // SDL3 destroys the GL context immediately before it destroys the window.
        destroy: () => undefined,
    };
}
