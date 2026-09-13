const DEFAULT_AUTOTOGGLE_INTERVAL_SECONDS = 15;

/** Reads the autotoggle period from .env, expressed in seconds. */
export function getAutotoggleIntervalMs(
    environment: NodeJS.ProcessEnv = process.env,
): number {
    const value = Number(environment.AUTOTOGGLE_INTERVAL);
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_AUTOTOGGLE_INTERVAL_SECONDS * 1000;
    }
    return value * 1000;
}

/** Returns true only for a non-repeating plus-key press. */
export function isLoopDemoShortcut(
  key: string | null,
  repeat: number | boolean = 0,
): boolean {
  return !repeat && key === "+";
}

/** Accepts the space key names emitted by browser and native SDL adapters. */
export function isAutoToggleShortcut(
  key: string | null | undefined,
  repeat: number | boolean = 0,
  code?: string | null,
): boolean {
  if (repeat) return false;
  const normalizedKeys = [key, code].map((value) => String(value ?? "").toLowerCase());
  return normalizedKeys.includes(" ") || normalizedKeys.includes("space") ||
    normalizedKeys.includes("spacebar");
}

/** RTP remains manual-only because an unavailable stream can reconnect forever. */
export function shouldSkipAutoScene(sceneName: string): boolean {
  return sceneName === "rtp-video";
}

/** Owns the automatic all-scene timer shared by both demo versions. */
export function createDemoLoop(
  advanceScene: () => void,
  onToggle?: (enabled: boolean) => void,
) {
  const intervalMs = getAutotoggleIntervalMs();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = (announce: boolean): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    if (announce) console.warn("AUTO_SCENES disabled");
    if (announce) onToggle?.(false);
  };

  const start = (): void => {
    if (timer !== undefined) return;
    console.warn(
      `AUTO_SCENES enabled: advancing all scenes every ${intervalMs / 1000} seconds`,
    );
    onToggle?.(true);
    timer = setInterval(advanceScene, intervalMs);
  };

  start();

  return {
    get enabled(): boolean {
      return timer !== undefined;
    },
    toggle(): void {
      if (timer === undefined) start();
      else stop(true);
    },
    destroy(): void {
      stop(false);
    },
  };
}
