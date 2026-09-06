import * as sdl from "@kmamal/sdl";

import type { NodeRenderSurface, NodeWindowHandle } from "./nativeTypes.ts";
import { NodeGLCanvas } from "./NodeGLCanvas.ts";
import { setNativeWindowTransparent } from "./ModalFrameController.ts";
import type { ResolvedNodeRendererOptions } from "./windowOptions.ts";
import { installWebGlMultisampleScreen } from "./webglMultisampleScreen.ts";

class WebGLRenderingContext {}

export interface WindowsAngleWebGLSurface {
  readonly window: NodeWindowHandle;
  readonly nativeWindowData: Uint8Array;
  readonly canvas: NodeGLCanvas;
  readonly webgl: WebGL2RenderingContext;
  readonly renderer: NodeRenderSurface;
  readonly webglRenderingContextConstructor: { readonly prototype: object };
}

/** Creates the proven Windows transparency path: SDL HWND -> ANGLE/EGL. */
export async function createWindowsAngleWebGLSurface(
  options: ResolvedNodeRendererOptions,
): Promise<WindowsAngleWebGLSurface> {
  if (process.platform !== "win32") {
    throw new Error("ANGLE window surfaces are used only on Windows");
  }

  const window = sdl.video.createWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    resizable: options.resizable,
    borderless: options.borderless,
    x: options.x,
    y: options.y,
  });
  const nativeWindowData = window.native.handle;
  if (!nativeWindowData) {
    window.destroy();
    throw new Error("SDL did not expose the native Windows handle for ANGLE");
  }

  try {
    setNativeWindowTransparent(nativeWindowData, options.transparent);

    const webglNode = await import("webgl-node");
    const context = webglNode.createWebGL2Context(
      window.pixelWidth,
      window.pixelHeight,
      { nativeWindow: nativeWindowData },
    );
    if (!context.swapBuffers) {
      context.destroy();
      throw new Error("ANGLE created no presentable EGL window surface");
    }
    if (context.makeCurrent && !context.makeCurrent()) {
      context.destroy();
      throw new Error("ANGLE could not make the EGL context current");
    }
    if (
      context.setSwapInterval &&
      !context.setSwapInterval(options.vsync ? 1 : 0)
    ) {
      context.destroy();
      throw new Error("ANGLE could not configure the EGL swap interval");
    }

    const multisampleScreen = installWebGlMultisampleScreen(
      context.gl as WebGL2RenderingContext,
      window.pixelWidth,
      window.pixelHeight,
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
          throw new Error("ANGLE eglSwapBuffers failed");
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
      webgl: context.gl,
      renderer,
      webglRenderingContextConstructor: WebGLRenderingContext,
    };
  } catch (error) {
    if (!window.destroyed) window.destroy();
    throw new Error("Could not create the Windows ANGLE WebGL2 surface", {
      cause: error,
    });
  }
}
