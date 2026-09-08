const CORE_DEMO_SCENE_INDICES = [0, 1, 2, 3] as const;
const LOOP_DEMO_INTERVAL_MS = 2_000;

/** Returns true only for a non-repeating plus-key press. */
export function isLoopDemoShortcut(
  key: string | null,
  repeat: number | boolean = 0,
): boolean {
  return !repeat && key === "+";
}

/** Selects the next core scene while keeping media out of heap diagnostics. */
export function getNextLoopSceneIndex(currentIndex: number): number {
  const currentLoopIndex = CORE_DEMO_SCENE_INDICES.indexOf(
    currentIndex as (typeof CORE_DEMO_SCENE_INDICES)[number],
  );
  if (currentLoopIndex < 0) return CORE_DEMO_SCENE_INDICES[0];
  return CORE_DEMO_SCENE_INDICES[
    (currentLoopIndex + 1) % CORE_DEMO_SCENE_INDICES.length
  ];
}

/** Owns the diagnostic scene-loop timer shared by both demo versions. */
export function createDemoLoop(
  selectScene: (index: number) => void,
  getCurrentSceneIndex: () => number,
) {
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = (announce: boolean): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    if (announce) console.warn("LOOP_DEMO disabled");
  };

  const start = (): void => {
    if (timer !== undefined) return;
    console.warn(
      `LOOP_DEMO enabled: cycling core scenes every ${LOOP_DEMO_INTERVAL_MS} ms`,
    );
    timer = setInterval(() => {
      selectScene(getNextLoopSceneIndex(getCurrentSceneIndex()));
    }, LOOP_DEMO_INTERVAL_MS);
  };

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
