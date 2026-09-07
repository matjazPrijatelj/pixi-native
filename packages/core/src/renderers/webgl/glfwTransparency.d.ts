/** Requests an alpha-capable GLFW framebuffer before window creation. */
export declare function requestGlfwTransparency(rawGlfw: unknown, transparent: boolean): void;
/** Rejects a compositor/window combination that ignored transparency. */
export declare function assertGlfwTransparency(rawGlfw: unknown, windowHandle: unknown, transparent: boolean): void;
