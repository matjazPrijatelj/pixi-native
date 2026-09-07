import { NodeGLCanvas } from "../../canvas/NodeGLCanvas.ts";
import type { NodeRenderSurface, NodeWindowHandle } from "../../runtime/nativeTypes.ts";
import type { ResolvedNodeRendererOptions } from "../../runtime/windowOptions.ts";
export interface NodeGlfwDocument {
    readonly handle: unknown;
    createElement(name: string): unknown;
}
export interface NodeGlfwImageConstructor {
    new (): {
        src: string;
    };
    fromPixels(width: number, height: number, bitsPerPixel: number, pixels: Buffer): unknown;
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
export declare function createNodeGlfwWebGLSurface(options: ResolvedNodeRendererOptions, rendererName: string): Promise<NodeGlfwWebGLSurface>;
