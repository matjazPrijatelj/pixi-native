const LOOP_DEMO_INTERVAL_MS = 30_000;

/** Returns true only for a non-repeating plus-key press. */
export function isLoopDemoShortcut(
  key: string | null,
  repeat: number | boolean = 0,
): boolean {
  return !repeat && key === "+";
}

/** Owns the automatic all-scene timer shared by both demo versions. */
export function createDemoLoop(
  advanceScene: () => void,
  onToggle?: (enabled: boolean) => void,
) {
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
      `AUTO_SCENES enabled: advancing all scenes every ${LOOP_DEMO_INTERVAL_MS} ms`,
    );
    onToggle?.(true);
    timer = setInterval(advanceScene, LOOP_DEMO_INTERVAL_MS);
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
