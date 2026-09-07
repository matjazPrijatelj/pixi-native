type GlfwTransparencyApi = {
    readonly TRUE: number;
    readonly FALSE: number;
    readonly ALPHA_BITS: number;
    readonly TRANSPARENT_FRAMEBUFFER: number;
    windowHint(hint: number, value: number): void;
    getWindowAttrib(window: unknown, attribute: number): number;
};

/** Requests an alpha-capable GLFW framebuffer before window creation. */
export function requestGlfwTransparency(
    rawGlfw: unknown,
    transparent: boolean,
): void {
    const glfw = rawGlfw as GlfwTransparencyApi;
    glfw.windowHint(
        glfw.TRANSPARENT_FRAMEBUFFER,
        transparent ? glfw.TRUE : glfw.FALSE,
    );
    if (transparent) glfw.windowHint(glfw.ALPHA_BITS, 8);
}

/** Rejects a compositor/window combination that ignored transparency. */
export function assertGlfwTransparency(
    rawGlfw: unknown,
    windowHandle: unknown,
    transparent: boolean,
): void {
    if (!transparent) return;
    const glfw = rawGlfw as GlfwTransparencyApi;
    if (
        glfw.getWindowAttrib(windowHandle, glfw.TRANSPARENT_FRAMEBUFFER) !==
        glfw.TRUE
    ) {
        throw new Error("GLFW could not create a transparent framebuffer");
    }
}

