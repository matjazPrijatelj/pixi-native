export interface ModalFrameRenderer {
    setModalFrameCallback?(callback?: () => void): void;
    setModalStateCallback?(callback?: (active: boolean) => void): void;
}

export function requireWindowsModalFrameSupport(
    renderer: ModalFrameRenderer,
    platform = process.platform,
): void {
    if (
        platform === "win32" &&
        (
            typeof renderer.setModalFrameCallback !== "function" ||
            typeof renderer.setModalStateCallback !== "function"
        )
    ) {
        throw new Error(
            "The Windows Dawn addon is outdated and cannot animate during window move/resize. " +
                "Rebuild it with `pnpm native:build`.",
        );
    }
}
