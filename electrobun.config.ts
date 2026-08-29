import type { ElectrobunConfig } from "electrobun";

export default {
    app: {
        name: "Pixi Electrobun WGPU",
        identifier: "dev.example.pixi-electrobun-wgpu",
        version: "0.1.0"
    },
    build: {
        mainProcess: "bun",
        bun: {
            entrypoint: "src/main.ts",
            external: ["skia-canvas"]
        },
        mac: { bundleWGPU: true },
        win: { bundleWGPU: true },
        linux: { bundleWGPU: true }
    },
    runtime: {
        exitOnLastWindowClosed: true
    }
} satisfies ElectrobunConfig;
