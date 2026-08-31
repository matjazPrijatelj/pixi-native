const NUMBER_KEYS: Readonly<Record<string, number>> = {
  "1": 0,
  "2": 1,
  "3": 2,
  "4": 3,
  "5": 4,
  "6": 5,
};

/** Returns the scene selected by a non-repeating SDL key press, or null for other keys. */
export function getSceneIndexForKey(
  key: string | null,
  currentIndex: number,
  sceneCount: number,
  repeat = 0,
): number | null {
  if (repeat || sceneCount <= 0) return null;
  const numberedIndex = key === null ? undefined : NUMBER_KEYS[key];
  if (numberedIndex !== undefined && numberedIndex < sceneCount)
    return numberedIndex;
  if (key === "left") return (currentIndex - 1 + sceneCount) % sceneCount;
  if (key === "right") return (currentIndex + 1) % sceneCount;
  return null;
}

/** Returns the next video index for a non-repeating up/down press, or null otherwise. */
export function getVideoIndexForKey(
  key: string | null,
  currentIndex: number,
  videoCount: number,
  repeat = 0,
): number | null {
  if (repeat || videoCount <= 0) return null;
  if (key === "up") return (currentIndex - 1 + videoCount) % videoCount;
  if (key === "down") return (currentIndex + 1) % videoCount;
  return null;
}

/** Returns the Sprite-test population delta for a non-repeating up/down press. */
export function getSpriteCountDeltaForKey(
  key: string | null,
  repeat = 0,
): number | null {
  if (repeat) return null;
  if (key === "up") return 10;
  if (key === "down") return -10;
  return null;
}
