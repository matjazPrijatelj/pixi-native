import { NodeGLCanvas } from "../../canvas/NodeGLCanvas.ts";
import type {
    NodeRenderSurface,
    NodeWindowHandle,
} from "../../runtime/nativeTypes.ts";
import { createNativeWindow } from "../../runtime/NativeWindow.ts";
import type { ResolvedNodeRendererOptions } from "../../runtime/windowOptions.ts";
import { warnAntialiasSampleFallback } from "../../runtime/windowOptions.ts";
import { installWebGlMultisampleScreen } from "./webglMultisampleScreen.ts";
import {
    createSdlWebGL2Context,
    loadNativeGl,
} from "./SdlWebGLContext.ts";

class WebGLRenderingContext {}

export interface NodeSdlWebGLSurface {
    readonly window: NodeWindowHandle;
    readonly nativeWindowData: Uint8Array;
    readonly canvas: NodeGLCanvas;
    readonly renderer: NodeRenderSurface;
    readonly webgl: WebGL2RenderingContext;
    readonly antialiasSamples: 0 | 2 | 4 | 8;
    readonly webglRenderingContextConstructor: { readonly prototype: object };
}

/** Creates an SDL-owned native window with an EGL/OpenGL ES WebGL2 surface. */
export async function createNodeSdlWebGLSurface(
    options: ResolvedNodeRendererOptions,
    rendererName: string,
): Promise<NodeSdlWebGLSurface> {
    const nativeGl = loadNativeGl();
    const window = createNativeWindow(options, "webgl");
    const nativeWindowData = window.surface.window;

    try {
        const context = await createSdlWebGL2Context(window, nativeGl);
        const webglNode = await import("webgl-node");
        if (!context.swapBuffers) {
            context.destroy();
            throw new Error("EGL created no presentable SDL window surface");
        }
        if (context.makeCurrent && !context.makeCurrent()) {
            context.destroy();
            throw new Error("EGL could not make the WebGL context current");
        }
        if (
            context.setSwapInterval &&
            !context.setSwapInterval(options.vsync ? 1 : 0)
        ) {
            context.destroy();
            throw new Error("EGL could not configure the swap interval");
        }

        const multisampleScreen = installWebGlMultisampleScreen(
            context.gl,
            window.pixelWidth,
            window.pixelHeight,
            options.antialiasSamples,
        );
        warnAntialiasSampleFallback(
            rendererName,
            options.antialiasSamples,
            multisampleScreen.sampleCount,
        );

        const canvas = new NodeGLCanvas(
            context.gl,
            window.pixelWidth,
            window.pixelHeight,
            (width, height) => {
                context.makeCurrent?.();
                context.resize(width, height);
                multisampleScreen.resize(width, height);
            },
        );
        context.gl.canvas = canvas as unknown as HTMLCanvasElement;

        const webglGlobals = webglNode as unknown as Record<string, unknown>;
        for (const name of [
            "WebGL2RenderingContext",
            "WebGLBuffer",
            "WebGLTexture",
            "WebGLFramebuffer",
            "WebGLRenderbuffer",
            "WebGLProgram",
            "WebGLShader",
            "WebGLVertexArrayObject",
            "WebGLSampler",
            "WebGLQuery",
            "WebGLSync",
            "WebGLTransformFeedback",
            "WebGLUniformLocation",
            "WebGLActiveInfo",
            "WebGLShaderPrecisionFormat",
        ]) {
            if (webglGlobals[name]) {
                (globalThis as Record<string, unknown>)[name] = webglGlobals[name];
            }
        }
        (globalThis as Record<string, unknown>).WebGLRenderingContext =
            WebGLRenderingContext;

        let destroyed = false;
        const renderer: NodeRenderSurface = {
            resize: (width, height) => canvas.resize(width, height),
            swap: () => {
                context.makeCurrent?.();
                multisampleScreen.resolve();
                if (!context.swapBuffers?.()) {
                    throw new Error("EGL swapBuffers failed");
                }
            },
            destroy: () => {
                if (destroyed) return;
                destroyed = true;
                context.makeCurrent?.();
                multisampleScreen.destroy();
                context.destroy();
            },
        };

        return {
            window: window as unknown as NodeWindowHandle,
            nativeWindowData,
            canvas,
            renderer,
            webgl: context.gl,
            antialiasSamples: multisampleScreen.sampleCount,
            webglRenderingContextConstructor: WebGLRenderingContext,
        };
    } catch (error) {
        if (!window.destroyed) window.destroy();
        throw new Error("Could not create the SDL WebGL2 surface", { cause: error });
    }
}
