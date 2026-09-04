import { Texture } from "pixi.js-v7";

/** Waits until a Pixi 7 texture has real dimensions before scene setup uses it. */
export function loadPixi7Texture(path: string): Promise<Texture> {
    const texture = Texture.from(path);
    const baseTexture = texture.baseTexture;
    if (baseTexture.valid) return Promise.resolve(texture);

    return new Promise((resolve, reject) => {
        const cleanup = (): void => {
            baseTexture.off("loaded", onLoaded);
            baseTexture.off("error", onError);
        };
        const onLoaded = (): void => {
            cleanup();
            resolve(texture);
        };
        const onError = (_source: unknown, error: unknown): void => {
            cleanup();
            reject(error instanceof Error ? error : new Error(`Unable to load texture: ${path}`));
        };
        baseTexture.once("loaded", onLoaded);
        baseTexture.once("error", onError);
    });
}
