import {
  copyRgbaRowsFlippedY,
  prepareRgbaPixelsForUpload,
} from "./rgbaUpload.ts";
import { NodeCanvas } from "./NodeCanvas.ts";

type WebGlImageSource = {
  readonly width: number;
  readonly height: number;
  readonly data?: Uint8Array | Uint8ClampedArray;
  getContext?: (type: string) => unknown;
  getPremultipliedRgbaPixels?: () => Uint8Array;
};

type Canvas2DReadContext = {
  drawImage?: (
    source: WebGlImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { readonly data: Uint8Array | Uint8ClampedArray };
};

export interface WebGlImageUploadContext {
  readonly RGBA: number;
  readonly UNSIGNED_BYTE: number;
  readonly UNPACK_FLIP_Y_WEBGL: number;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL: number;
  getParameter(parameter: number): unknown;
  texImage2D(...args: unknown[]): void;
  texSubImage2D(...args: unknown[]): void;
}

function isImageSource(value: unknown): value is WebGlImageSource {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) {
    return false;
  }
  const source = value as Partial<WebGlImageSource>;
  return (
    Number.isInteger(source.width) &&
    Number.isInteger(source.height) &&
    Number(source.width) > 0 &&
    Number(source.height) > 0
  );
}

function readImagePixels(
  gl: WebGlImageUploadContext,
  source: WebGlImageSource,
): Uint8Array {
  const expectedBytes = source.width * source.height * 4;
  const premultiply = Boolean(
    gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),
  );
  let pixels: Uint8Array;
  let alreadyPremultiplied = false;

  if (premultiply && source.getPremultipliedRgbaPixels) {
    pixels = source.getPremultipliedRgbaPixels();
    alreadyPremultiplied = true;
  } else {
    const context = source.getContext?.("2d") as
      | Canvas2DReadContext
      | undefined;
    const canvasPixels = context?.getImageData(
      0,
      0,
      source.width,
      source.height,
    ).data;
    if (canvasPixels) {
      pixels = new Uint8Array(
        canvasPixels.buffer,
        canvasPixels.byteOffset,
        canvasPixels.byteLength,
      );
    } else if (source.data) {
      pixels = new Uint8Array(expectedBytes);
      copyRgbaRowsFlippedY(
        pixels,
        source.data,
        source.width,
        source.height,
      );
    } else if (source.getPremultipliedRgbaPixels) {
      pixels = source.getPremultipliedRgbaPixels();
      alreadyPremultiplied = true;
    } else {
      const canvas = new NodeCanvas(source.width, source.height);
      const fallbackContext = canvas.getContext("2d") as Canvas2DReadContext;
      if (typeof fallbackContext.drawImage !== "function") {
        throw new Error("WebGL image source cannot provide RGBA pixels");
      }
      try {
        fallbackContext.drawImage(
          source,
          0,
          0,
          source.width,
          source.height,
        );
      } catch (error) {
        throw new Error("WebGL image source cannot be decoded to RGBA pixels", {
          cause: error,
        });
      }
      if (premultiply) {
        pixels = canvas.getPremultipliedRgbaPixels();
        alreadyPremultiplied = true;
      } else {
        const fallbackPixels = fallbackContext.getImageData(
          0,
          0,
          source.width,
          source.height,
        ).data;
        pixels = new Uint8Array(
          fallbackPixels.buffer,
          fallbackPixels.byteOffset,
          fallbackPixels.byteLength,
        );
      }
    }
  }

  if (pixels.byteLength !== expectedBytes) {
    throw new Error(
      `WebGL image source ${source.width}x${source.height} provided ${pixels.byteLength} RGBA bytes; expected ${expectedBytes}`,
    );
  }

  if (premultiply && !alreadyPremultiplied) {
    pixels = prepareRgbaPixelsForUpload(pixels, "rgba8unorm", true);
  }

  if (Boolean(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL))) {
    const flipped = new Uint8Array(pixels.byteLength);
    copyRgbaRowsFlippedY(flipped, pixels, source.width, source.height);
    pixels = flipped;
  }

  return pixels;
}

function assertRgbaByteUpload(
  gl: WebGlImageUploadContext,
  format: unknown,
  type: unknown,
): void {
  if (format !== gl.RGBA || type !== gl.UNSIGNED_BYTE) {
    throw new Error(
      "Native Canvas WebGL uploads require RGBA/UNSIGNED_BYTE",
    );
  }
}

/** Normalizes Pixi's browser image-source overloads to native RGBA uploads. */
export function installWebGlImageUploadAdapter(
  gl: WebGlImageUploadContext,
): void {
  const nativeTexImage2D = gl.texImage2D.bind(gl);
  const nativeTexSubImage2D = gl.texSubImage2D.bind(gl);

  gl.texImage2D = (...args: unknown[]): void => {
    if (args.length === 9 && isImageSource(args[8])) {
      assertRgbaByteUpload(gl, args[6], args[7]);
      args[8] = readImagePixels(gl, args[8]);
    } else if (args.length === 6 && isImageSource(args[5])) {
      const source = args[5];
      assertRgbaByteUpload(gl, args[3], args[4]);
      args = [
        args[0],
        args[1],
        args[2],
        source.width,
        source.height,
        0,
        args[3],
        args[4],
        readImagePixels(gl, source),
      ];
    }
    nativeTexImage2D(...args);
  };

  gl.texSubImage2D = (...args: unknown[]): void => {
    if (args.length === 9 && isImageSource(args[8])) {
      assertRgbaByteUpload(gl, args[6], args[7]);
      args[8] = readImagePixels(gl, args[8]);
    } else if (args.length === 7 && isImageSource(args[6])) {
      const source = args[6];
      assertRgbaByteUpload(gl, args[4], args[5]);
      args = [
        args[0],
        args[1],
        args[2],
        args[3],
        source.width,
        source.height,
        args[4],
        args[5],
        readImagePixels(gl, source),
      ];
    }
    nativeTexSubImage2D(...args);
  };
}
