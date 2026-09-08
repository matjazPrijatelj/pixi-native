export interface ParsedMediaSource {
  readonly source: string;
  readonly startTime: number;
  readonly endTime?: number;
}

const AUTHENTICATED_URL_PATTERN =
  /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu;

export function parseMediaSource(value: string): ParsedMediaSource {
  const marker = value.lastIndexOf("#t=");
  if (marker < 0) return { source: value, startTime: 0 };

  const fragment = value.slice(marker + 3);
  const [rawStart = "0", rawEnd] = fragment.split(",", 2);
  const startTime = rawStart === "" ? 0 : Number(rawStart);
  const endTime =
    rawEnd === undefined || rawEnd === "" ? undefined : Number(rawEnd);
  if (!Number.isFinite(startTime) || startTime < 0) {
    throw new Error(`Invalid media fragment start time: ${rawStart}`);
  }
  if (
    endTime !== undefined &&
    (!Number.isFinite(endTime) || endTime <= startTime)
  ) {
    throw new Error(`Invalid media fragment end time: ${rawEnd}`);
  }
  return { source: value.slice(0, marker), startTime, endTime };
}

export function redactMediaSource(value: string): string {
  return value.replace(AUTHENTICATED_URL_PATTERN, "$1***:***@");
}
