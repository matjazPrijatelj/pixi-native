export interface ModalFrameListeners {
  add(listener: () => void): () => void;
  dispatch(): void;
  clear(): void;
}

/** Keeps backend modal-frame listeners mutation-safe while they are dispatched. */
export function createModalFrameListeners(): ModalFrameListeners {
  const listeners = new Set<() => void>();

  return {
    add(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch() {
      for (const listener of [...listeners]) listener();
    },
    clear() {
      listeners.clear();
    },
  };
}
