/** Requests an alpha-capable GLFW framebuffer before window creation. */
export function requestGlfwTransparency(rawGlfw, transparent) {
    const glfw = rawGlfw;
    glfw.windowHint(glfw.TRANSPARENT_FRAMEBUFFER, transparent ? glfw.TRUE : glfw.FALSE);
    if (transparent)
        glfw.windowHint(glfw.ALPHA_BITS, 8);
}
/** Rejects a compositor/window combination that ignored transparency. */
export function assertGlfwTransparency(rawGlfw, windowHandle, transparent) {
    if (!transparent)
        return;
    const glfw = rawGlfw;
    if (glfw.getWindowAttrib(windowHandle, glfw.TRANSPARENT_FRAMEBUFFER) !==
        glfw.TRUE) {
        throw new Error("GLFW could not create a transparent framebuffer");
    }
}
