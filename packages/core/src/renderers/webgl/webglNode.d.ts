declare module "webgl-node" {
    export interface WebGLNodeContextResult {
        readonly gl: WebGL2RenderingContext & { canvas: unknown };
        readonly makeCurrent: (() => boolean) | null;
        readonly resize: (width: number, height: number) => boolean;
        readonly swapBuffers?: () => boolean;
        readonly setSwapInterval?: ((interval: number) => boolean) | null;
        readonly destroy: () => void;
    }

    export function createWebGL2Context(
        width: number,
        height: number,
        options?: { readonly nativeWindow?: Uint8Array },
    ): WebGLNodeContextResult;
}
