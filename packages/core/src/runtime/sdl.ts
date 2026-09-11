import { createRequire } from "node:module";
import { configureSdlPlatform } from "./sdlPlatform.ts";

configureSdlPlatform();
// A static import initializes SDL before the platform can be selected.
const sdl: typeof import("@kmamal/sdl") = createRequire(import.meta.url)(
    "@kmamal/sdl",
);
if (
    process.platform === "linux" &&
    process.env.PIXI_NATIVE_HEADLESS !== "1" &&
    sdl.info.drivers.video.current !== "x11"
) {
    throw new Error(
        "[pixi-native] SDL was initialized with a non-X11 video driver before the native runtime",
    );
}
export default sdl;
