export interface PortablePackageOptions {
    readonly platform: "win32" | "linux";
    readonly runtimeVersion: string;
    readonly facadeArchiveName: string;
    readonly nativeArchiveName: string;
    readonly pixiVersion: string;
    readonly pixi7Version: string;
    readonly gsapVersion: string;
}

export interface PortablePackageManifest {
    readonly name: string;
    readonly version: string;
    readonly private: true;
    readonly type: "module";
    readonly engines: { readonly node: string };
    readonly dependencies: Record<string, string>;
}

export function rewritePortableDemoImports(source: string): string;
export function shouldIncludePortableInput(relativePath: string): boolean;
export function createPortablePackageManifest(
    options: PortablePackageOptions,
): PortablePackageManifest;
