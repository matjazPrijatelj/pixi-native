export interface VideoRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export function fitVideoRect(sourceWidth: number, sourceHeight: number, viewportWidth: number, viewportHeight: number, topInset = 92): VideoRect {
    if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error("Video dimensions must be positive");
    const width = Math.max(1, viewportWidth);
    const height = Math.max(1, viewportHeight - topInset);
    const scale = Math.min(width / sourceWidth, height / sourceHeight);
    const fittedWidth = sourceWidth * scale;
    const fittedHeight = sourceHeight * scale;
    return { x: (width - fittedWidth) / 2, y: topInset + (height - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}
