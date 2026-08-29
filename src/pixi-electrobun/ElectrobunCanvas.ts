import type { GpuWindow } from "electrobun/main";

/** Canvas-shaped surface backed by Electrobun's native WGPU view. */
export class ElectrobunCanvas {
    public readonly style: Record<string, string> = {};
    public width: number;
    public height: number;

    public constructor(private readonly window: GpuWindow, width = 1280, height = 720) {
        this.width = width;
        this.height = height;
    }

    public get clientWidth(): number { return this.width; }
    public get clientHeight(): number { return this.height; }
    public getContext(type: string): unknown {
        if (type !== "webgpu") return null;
        return null;
    }

    public resize(width: number, height: number): void {
        this.width = Math.max(1, Math.floor(width));
        this.height = Math.max(1, Math.floor(height));
        void this.window;
    }
}
