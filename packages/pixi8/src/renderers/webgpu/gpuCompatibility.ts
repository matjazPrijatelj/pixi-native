export function normalizeGpuBindGroupIndex(index: number | string): number {
  const normalized = Number(index);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`Invalid WebGPU bind group index: ${index}`);
  }
  return normalized;
}
