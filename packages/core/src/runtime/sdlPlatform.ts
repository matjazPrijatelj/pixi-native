/** SDL and native-gles must agree on X11 before either library initializes. */
export function configureSdlPlatform(
    platform: NodeJS.Platform = process.platform,
    environment: NodeJS.ProcessEnv = process.env,
): void {
    if (platform !== "linux" || environment.PIXI_NATIVE_HEADLESS === "1")
        return;
    if (!environment.DISPLAY) {
        throw new Error(
            "[pixi-native] Linux native windows require X11/XWayland; DISPLAY is unavailable",
        );
    }
    if (environment.SDL_VIDEODRIVER && environment.SDL_VIDEODRIVER !== "x11") {
        throw new Error(
            "[pixi-native] Linux native windows require SDL_VIDEODRIVER=x11 (XWayland is supported)",
        );
    }
    environment.SDL_VIDEODRIVER = "x11";
}
