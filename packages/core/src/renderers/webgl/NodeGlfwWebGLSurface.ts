import { NodeGLCanvas } from "../../canvas/NodeGLCanvas.ts";
import { NodeGLWindow } from "./NodeGLWindow.ts";
import type {
  NodeRenderSurface,
  NodeWindowHandle,
} from "../../runtime/nativeTypes.ts";
import type { ResolvedNodeRendererOptions } from "../../runtime/windowOptions.ts";
import { warnAntialiasSampleFallback } from "../../runtime/windowOptions.ts";
import {
  assertGlfwTransparency,
  requestGlfwTransparency,
} from "./glfwTransparency.ts";

export interface NodeGlfwDocument {
  readonly handle: unknown;
  createElement(name: string): unknown;
}

export interface NodeGlfwImageConstructor {
  new (): { src: string };
  fromPixels(
    width: number,
    height: number,
    bitsPerPixel: number,
    pixels: Buffer,
  ): unknown;
}

export interface NodeGlfwWebGLSurface {
  readonly window: NodeWindowHandle;
  readonly nativeWindowData: Uint8Array;
  readonly canvas: NodeGLCanvas;
  readonly renderer: NodeRenderSurface;
  readonly document: NodeGlfwDocument;
  readonly webgl: any;
  readonly imageConstructor: NodeGlfwImageConstructor;
  readonly webglRenderingContextConstructor: {
    readonly prototype: object;
  };
}

/** Creates the shared GLFW/OpenGL ES surface used by both Pixi versions. */
export async function createNodeGlfwWebGLSurface(
  options: ResolvedNodeRendererOptions,
  rendererName: string,
): Promise<NodeGlfwWebGLSurface> {
  const { init, gl, Image } = await import("@node-3d/core");
  const { glfw } = await import("@node-3d/glfw");
  const { doc } = init({
    title: options.title,
    width: options.width,
    height: options.height,
    resizable: options.resizable,
    decorated: !options.borderless,
    vsync: options.vsync,
    msaa: options.antialiasSamples,
    isGles3: true,
    isWebGL2: true,
    autoEsc: true,
    onBeforeWindow: (_window: unknown, rawGlfw: unknown) => {
      requestGlfwTransparency(rawGlfw, options.transparent);
    },
  });

  assertGlfwTransparency(glfw, doc.handle, options.transparent);
  warnAntialiasSampleFallback(
    rendererName,
    options.antialiasSamples,
    Number(gl.getParameter(gl.SAMPLES)),
  );

  const glfwWindow = new NodeGLWindow(doc as never, {
    pollEvents: glfw.pollEvents,
    maximize: () => glfw.maximizeWindow(doc.handle),
  });
  if (options.x !== undefined && options.y !== undefined) {
    glfwWindow.setPosition(options.x, options.y);
  }

  const canvas = new NodeGLCanvas(
    gl,
    glfwWindow.pixelWidth,
    glfwWindow.pixelHeight,
  );
  const renderer: NodeRenderSurface = {
    resize: (width, height) => canvas.resize(width, height),
    swap: () => glfwWindow.swapBuffers(),
    destroy: () => undefined,
  };

  return {
    window: glfwWindow,
    nativeWindowData: glfwWindow.nativeWindowData,
    canvas,
    renderer,
    document: doc,
    webgl: gl,
    imageConstructor: Image,
    webglRenderingContextConstructor: gl.WebGLRenderingContext,
  };
}

