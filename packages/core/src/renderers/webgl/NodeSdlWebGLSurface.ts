import * as sdl from "@kmamal/sdl";

import { NodeGLCanvas } from "../../canvas/NodeGLCanvas.ts";
import type {
    NodeRenderSurface,
    NodeWindowHandle,
} from "../../runtime/nativeTypes.ts";
import { setNativeWindowTransparent } from "../../runtime/ModalFrameController.ts";
import type { ResolvedNodeRendererOptions } from "../../runtime/windowOptions.ts";
import { warnAntialiasSampleFallback } from "../../runtime/windowOptions.ts";
import { installWebGlMultisampleScreen } from "./webglMultisampleScreen.ts";

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
    const window = sdl.video.createWindow({
        title: options.title,
        width: options.width,
        height: options.height,
        resizable: options.resizable,
        borderless: options.borderless,
        x: options.x,
        y: options.y,
        opengl: true,
    });
    const sdlWindow = window as unknown as {
        readonly native: { readonly gl?: Uint8Array; readonly handle?: Uint8Array };
        readonly _native?: { readonly gpu?: Uint8Array };
    };
    const nativeGlWindow = sdlWindow.native.gl ?? sdlWindow.native.handle;
    const nativeWindowData = sdlWindow._native?.gpu ?? sdlWindow.native.handle;
    if (!nativeGlWindow || !nativeWindowData) {
        window.destroy();
        throw new Error("SDL did not expose the native window handles required by WebGL");
    }

    try {
        setNativeWindowTransparent(nativeWindowData, options.transparent);
        const webglNode = await import("webgl-node");
        const context = webglNode.createWebGL2Context(
            window.pixelWidth,
            window.pixelHeight,
            { nativeWindow: nativeGlWindow },
        );
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
