interface ModalFrameSource {
    readonly addModalFrameListener?: (
        listener: () => void,
    ) => () => void;
}

interface ManualTicker {
    tick(): void;
}

type AddDestroyListener = (
    listener: () => void | Promise<void>,
) => () => void;

/** Advances GSAP inside the native Windows move/resize modal frame loop. */
export function installGsapModalBridge(
    source: ModalFrameSource,
    ticker: ManualTicker,
    addDestroyListener: AddDestroyListener,
): void {
    const removeListener = source.addModalFrameListener?.(() => ticker.tick());
    if (removeListener) addDestroyListener(removeListener);
}
