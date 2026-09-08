type WebGlTypedArray<T extends ArrayBufferView> = T & {
  readonly length: number;
  slice(start: number, end?: number): T;
};

/**
 * Returns a compact copy of the element range requested by WebGL's
 * bufferSubData overload. Native WebGL must receive a zero-offset view.
 */
export function sliceWebGlBufferData<T extends ArrayBufferView>(
  data: WebGlTypedArray<T>,
  srcOffset = 0,
  length = data.length - srcOffset,
): T {
  return data.slice(srcOffset, srcOffset + length);
}
