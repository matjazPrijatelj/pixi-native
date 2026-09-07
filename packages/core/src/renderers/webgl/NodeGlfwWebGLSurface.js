import { NodeGLCanvas } from "../../canvas/NodeGLCanvas.js";
import { NodeGLWindow } from "./NodeGLWindow.js";
import { warnAntialiasSampleFallback } from "../../runtime/windowOptions.js";
import { assertGlfwTransparency, requestGlfwTransparency, } from "./glfwTransparency.js";
/** Creates the shared GLFW/OpenGL ES surface used by both Pixi versions. */
export async function createNodeGlfwWebGLSurface(options, rendererName) {
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
        onBeforeWindow: (_window, rawGlfw) => {
            requestGlfwTransparency(rawGlfw, options.transparent);
        },
    });
    assertGlfwTransparency(glfw, doc.handle, options.transparent);
    warnAntialiasSampleFallback(rendererName, options.antialiasSamples, Number(gl.getParameter(gl.SAMPLES)));
    const glfwWindow = new NodeGLWindow(doc, {
        pollEvents: glfw.pollEvents,
        maximize: () => glfw.maximizeWindow(doc.handle),
    });
    if (options.x !== undefined && options.y !== undefined) {
        glfwWindow.setPosition(options.x, options.y);
    }
    const canvas = new NodeGLCanvas(gl, glfwWindow.pixelWidth, glfwWindow.pixelHeight);
    const renderer = {
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
