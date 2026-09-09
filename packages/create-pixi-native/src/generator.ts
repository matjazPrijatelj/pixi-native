import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PixiMajor = "7" | "8";
export type RendererBackend = "webgpu" | "webgl";
export type AnimationEngine = "ticker" | "gsap";

export interface CreateProjectOptions {
    readonly targetDirectory: string;
    readonly pixi: PixiMajor;
    readonly backend: RendererBackend;
    readonly animation?: AnimationEngine;
    readonly cwd?: string;
}

export const GENERATOR_VERSION = "0.1.0";
export const PIXI_NATIVE_VERSION = "0.1.1";
const TEMPLATE_ROOT = fileURLToPath(new URL("../templates/", import.meta.url));
const PROJECT_NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const GENERATED_ASSET = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZB8sAAAAASUVORK5CYII=",
    "base64",
);

const TEMPLATE_RENAMES = new Map([
    ["gitignore.template", ".gitignore"],
    ["npmrc.template", ".npmrc"],
    ["prettierignore.template", ".prettierignore"],
    ["package.json.template", "package.json"],
]);

export async function createProject(options: CreateProjectOptions): Promise<string> {
    if (options.pixi === "7" && options.backend !== "webgl") {
        throw new Error("PixiJS 7 supports only the WebGL backend.");
    }

    const cwd = options.cwd ?? process.cwd();
    const animation = options.animation ?? "ticker";
    const targetDirectory = resolve(cwd, options.targetDirectory);
    const projectName = basename(targetDirectory);
    validateProjectName(projectName);
    await assertEmptyTarget(targetDirectory);
    await mkdir(targetDirectory, { recursive: true });
    await copyTemplateDirectory(resolve(TEMPLATE_ROOT, "common"), targetDirectory);
    await copyTemplateDirectory(resolve(TEMPLATE_ROOT, `pixi${options.pixi}`), targetDirectory);
    await copyTemplateDirectory(resolve(TEMPLATE_ROOT, "animation", animation), targetDirectory);
    await mkdir(resolve(targetDirectory, "assets"), { recursive: true });
    await writeFile(resolve(targetDirectory, "assets", "pixi-native.png"), GENERATED_ASSET);
    await replaceTemplateTokens(targetDirectory, {
        PROJECT_NAME: projectName,
        PIXI_MAJOR: options.pixi,
        BACKEND: options.backend,
        PIXI_NATIVE_VERSION,
        PIXI_PACKAGE_NAME: options.pixi === "7" ? "pixi.js-v7" : "pixi.js",
        PIXI_PACKAGE_VERSION: options.pixi === "7" ? "npm:pixi.js@^7.4.3" : "^8.20.0",
        PIXI_IMPORT_PATH:
            options.pixi === "7"
                ? "@matjazprijatelj/pixi-native/pixi7"
                : "@matjazprijatelj/pixi-native",
        ANIMATION_ENGINE: animation,
        GSAP_DEPENDENCY: animation === "gsap" ? ',\n    "gsap": "^3.15.0"' : "",
    });
    return targetDirectory;
}

export function validateProjectName(projectName: string): void {
    if (!PROJECT_NAME_PATTERN.test(projectName)) {
        throw new Error(
            "The project directory name must use lowercase letters, numbers, dots, hyphens, or underscores.",
        );
    }
}

async function assertEmptyTarget(targetDirectory: string): Promise<void> {
    try {
        const targetStat = await stat(targetDirectory);
        if (!targetStat.isDirectory()) {
            throw new Error(`Target exists and is not a directory: ${targetDirectory}`);
        }
        if ((await readdir(targetDirectory)).length > 0) {
            throw new Error(`Target directory is not empty: ${targetDirectory}`);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
}

async function copyTemplateDirectory(source: string, target: string): Promise<void> {
    await cp(source, target, {
        recursive: true,
        filter: (path) => !path.endsWith(".template-placeholder"),
    });
}

async function replaceTemplateTokens(
    directory: string,
    values: Readonly<Record<string, string>>,
): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const sourcePath = resolve(directory, entry.name);
        if (entry.isDirectory()) {
            await replaceTemplateTokens(sourcePath, values);
            continue;
        }
        if (entry.name.endsWith(".png")) continue;

        let contents = await readFile(sourcePath, "utf8");
        for (const [name, value] of Object.entries(values)) {
            contents = contents.replaceAll(`{{${name}}}`, value);
        }
        const outputName = TEMPLATE_RENAMES.get(entry.name) ?? entry.name;
        const outputPath = resolve(directory, outputName);
        await writeFile(outputPath, contents);
        if (outputPath !== sourcePath) {
            await rm(sourcePath);
        }
    }
}
