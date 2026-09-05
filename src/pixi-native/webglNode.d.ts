declare module "webgl-node" {
  export interface WebGLNodeContextResult {
    readonly gl: WebGL2RenderingContext & {
      canvas: unknown;
      makeCurrent?: () => boolean;
    };
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

  export const WebGL2RenderingContext: { readonly prototype: object };
  export const WebGLBuffer: { readonly prototype: object };
  export const WebGLTexture: { readonly prototype: object };
  export const WebGLFramebuffer: { readonly prototype: object };
  export const WebGLRenderbuffer: { readonly prototype: object };
  export const WebGLProgram: { readonly prototype: object };
  export const WebGLShader: { readonly prototype: object };
  export const WebGLVertexArrayObject: { readonly prototype: object };
  export const WebGLSampler: { readonly prototype: object };
  export const WebGLQuery: { readonly prototype: object };
  export const WebGLSync: { readonly prototype: object };
  export const WebGLTransformFeedback: { readonly prototype: object };
  export const WebGLUniformLocation: { readonly prototype: object };
  export const WebGLActiveInfo: { readonly prototype: object };
  export const WebGLShaderPrecisionFormat: { readonly prototype: object };
}
