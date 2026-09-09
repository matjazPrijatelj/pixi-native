#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
    GENERATOR_VERSION,
    createProject,
    type PixiMajor,
    type RendererBackend,
} from "./generator.ts";

export interface ParsedCliArguments {
    readonly targetDirectory?: string;
    readonly pixi?: PixiMajor;
    readonly backend?: RendererBackend;
    readonly help: boolean;
    readonly version: boolean;
}

interface Prompt {
    question(message: string): Promise<string>;
    close(): void;
}

export function parseCliArguments(arguments_: readonly string[]): ParsedCliArguments {
    let targetDirectory: string | undefined;
    let pixi: PixiMajor | undefined;
    let backend: RendererBackend | undefined;
    let help = false;
    let version = false;

    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index];
        if (argument === "--help" || argument === "-h") {
            help = true;
        } else if (argument === "--version" || argument === "-v") {
            version = true;
        } else if (argument === "--pixi" || argument.startsWith("--pixi=")) {
            const value = readOptionValue(argument, arguments_, index);
            if (argument === "--pixi") index++;
            pixi = parsePixiMajor(value);
        } else if (argument === "--backend" || argument.startsWith("--backend=")) {
            const value = readOptionValue(argument, arguments_, index);
            if (argument === "--backend") index++;
            backend = parseBackend(value);
        } else if (argument.startsWith("-")) {
            throw new Error(`Unknown option: ${argument}`);
        } else if (targetDirectory) {
            throw new Error("Provide one target directory.");
        } else {
            targetDirectory = argument;
        }
    }

    return { targetDirectory, pixi, backend, help, version };
}

export async function resolveCliArguments(
    parsed: ParsedCliArguments,
    interactive: boolean,
    prompt?: Prompt,
): Promise<{ targetDirectory: string; pixi: PixiMajor; backend: RendererBackend }> {
    let targetDirectory = parsed.targetDirectory;
    let pixi = parsed.pixi;
    let backend = parsed.backend;

    if (!interactive && (!targetDirectory || !pixi || (!backend && pixi === "8"))) {
        throw new Error(
            "Non-interactive use requires a target directory, --pixi, and --backend for PixiJS 8.",
        );
    }
    if (!prompt && (!targetDirectory || !pixi || (!backend && pixi === "8"))) {
        throw new Error("Interactive input is unavailable.");
    }

    targetDirectory ||= (await prompt?.question("Project directory [pixi-native-app]: ")) ||
        "pixi-native-app";
    pixi ||= parsePixiMajor(
        (await prompt?.question("PixiJS version (7/8) [8]: ")) || "8",
    );
    if (pixi === "7") {
        if (backend && backend !== "webgl") {
            throw new Error("PixiJS 7 supports only the WebGL backend.");
        }
        backend = "webgl";
    } else {
        backend ||= parseBackend(
            (await prompt?.question("Renderer backend (webgpu/webgl) [webgpu]: ")) ||
                "webgpu",
        );
    }
    return { targetDirectory, pixi, backend };
}

async function main(): Promise<void> {
    const parsed = parseCliArguments(process.argv.slice(2));
    if (parsed.help) {
        printHelp();
        return;
    }
    if (parsed.version) {
        console.log(GENERATOR_VERSION);
        return;
    }

    const interactive = Boolean(stdin.isTTY && stdout.isTTY);
    const prompt = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
    try {
        const options = await resolveCliArguments(parsed, interactive, prompt);
        const targetDirectory = await createProject(options);
        console.log(`Created ${targetDirectory}`);
        console.log("Next steps:");
        console.log(`  cd ${options.targetDirectory}`);
        console.log("  pnpm install");
        console.log("  pnpm dev");
    } finally {
        prompt?.close();
    }
}

function readOptionValue(
    argument: string,
    arguments_: readonly string[],
    index: number,
): string {
    const equalsIndex = argument.indexOf("=");
    const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : arguments_[index + 1];
    if (!value || value.startsWith("-")) {
        throw new Error(`${argument.split("=")[0]} requires a value.`);
    }
    return value;
}

function parsePixiMajor(value: string): PixiMajor {
    if (value !== "7" && value !== "8") {
        throw new Error("--pixi must be 7 or 8.");
    }
    return value;
}

function parseBackend(value: string): RendererBackend {
    if (value !== "webgpu" && value !== "webgl") {
        throw new Error("--backend must be webgpu or webgl.");
    }
    return value;
}

function printHelp(): void {
    console.log(`Usage: create-pixi-native <directory> [options]

Options:
  --pixi <7|8>                 PixiJS major version
  --backend <webgpu|webgl>     Renderer backend; PixiJS 7 uses WebGL
  -h, --help                   Show this help
  -v, --version                Show the package version`);
}

const invokedPath = process.argv[1]
    ? pathToFileURL(realpathSync(resolve(process.argv[1]))).href
    : null;
if (invokedPath === import.meta.url) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
