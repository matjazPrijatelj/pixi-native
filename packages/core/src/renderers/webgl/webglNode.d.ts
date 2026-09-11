declare module "webgl-node" {
    import type { NativeSurfaceDescriptor } from "../../runtime/nativeTypes.ts";

    export interface WebGLNodeContextResult {
        readonly gl: WebGL2RenderingContext & { canvas: unknown };
        readonly makeCurrent: (() => boolean) | null;
        readonly resize: (width: number, height: number) => boolean;
        readonly swapBuffers?: () => boolean;
        readonly setSwapInterval?: ((interval: number) => boolean) | null;
        readonly destroy: () => void;
    }

    export class WebGL2RenderingContext {
        constructor(
            nativeGl: Record<string, unknown>,
            width: number,
            height: number,
            options: Record<string, unknown>,
        );
    }

    export function createWebGL2Context(
        width: number,
        height: number,
        options?: {
            readonly nativeWindow?: Uint8Array;
            readonly nativeSurface?: NativeSurfaceDescriptor;
        },
    ): WebGLNodeContextResult;
}
