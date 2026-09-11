/** Selects the GLFW platform before the native GLFW module is initialized. */
export function configureTransparentGlfwPlatform(
    platform: NodeJS.Platform = process.platform,
    transparent: boolean,
    environment: NodeJS.ProcessEnv = process.env,
): void {
    if (platform !== "linux" || !transparent) return;

    // GLFW Wayland windows do not expose the transparent framebuffer path used
    // by Pixi. XWayland provides the X11 compositor path that supports it.
    if (!environment.DISPLAY) {
        console.warn(
            "[pixi-native] Linux transparent GLFW windows require X11/XWayland; DISPLAY is unavailable",
        );
        return;
    }
    if (environment.GLFW_PLATFORM !== "x11") {
        environment.GLFW_PLATFORM = "x11";
    }
}
