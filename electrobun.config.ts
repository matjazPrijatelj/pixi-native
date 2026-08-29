import type { ElectrobunConfig } from "electrobun";

const ffmpegBinary = process.platform === "win32" ? "node_modules/ffmpeg-static/ffmpeg.exe" : "node_modules/ffmpeg-static/ffmpeg";
const ffmpegBundleName = process.platform === "win32" ? "ffmpeg/ffmpeg.exe" : "ffmpeg/ffmpeg";

export default {
    app: {
        name: "Pixi Electrobun WGPU",
        identifier: "dev.example.pixi-electrobun-wgpu",
        version: "0.1.0"
    },
    build: {
        mainProcess: "bun",
        copy: { "assets/test-texture.png": "assets/test-texture.png", "assets/Big_Buck_Bunny_720_10s_20MB.mp4": "assets/Big_Buck_Bunny_720_10s_20MB.mp4",
            [ffmpegBinary]: ffmpegBundleName },
        bun: {
            entrypoint: "src/main.ts",
            external: ["skia-canvas", "ffmpeg-static"]
        },
        mac: { bundleWGPU: true },
        win: { bundleWGPU: true },
        linux: { bundleWGPU: true }
    },
    runtime: {
        exitOnLastWindowClosed: true
    }
} satisfies ElectrobunConfig;
