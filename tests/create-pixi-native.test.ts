import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseCliArguments,
    resolveCliArguments,
} from "../packages/create-pixi-native/src/cli.ts";
import {
    GENERATOR_VERSION,
    PIXI_NATIVE_VERSION,
    createProject,
} from "../packages/create-pixi-native/src/generator.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("quickboot parses explicit Pixi and backend options", () => {
    assert.deepEqual(
        parseCliArguments(["display", "--pixi", "8", "--backend=webgpu"]),
        {
            targetDirectory: "display",
            pixi: "8",
            backend: "webgpu",
            help: false,
            version: false,
        },
    );
    assert.throws(
        () => parseCliArguments(["display", "--pixi", "9"]),
        /--pixi must be 7 or 8/,
    );
});

test("quickboot keeps generator and runtime versions independent", () => {
    assert.equal(GENERATOR_VERSION, "0.1.0");
    assert.equal(PIXI_NATIVE_VERSION, "0.1.1");
    assert.equal(
        execFileSync(
            process.execPath,
            [
                resolve(
                    REPOSITORY_ROOT,
                    "packages/create-pixi-native/src/cli.ts",
                ),
                "--version",
            ],
            { encoding: "utf8" },
        ).trim(),
        GENERATOR_VERSION,
    );
});

test("quickboot interactive defaults select PixiJS 8 WebGPU", async () => {
    const answers = ["", "", ""];
    const options = await resolveCliArguments(
        { help: false, version: false },
        true,
        {
            question: async () => answers.shift() ?? "",
            close: () => undefined,
        },
    );
    assert.deepEqual(options, {
        targetDirectory: "pixi-native-app",
        pixi: "8",
        backend: "webgpu",
    });
});

test("quickboot fixes PixiJS 7 to WebGL", async () => {
    assert.deepEqual(
        await resolveCliArguments(
            {
                targetDirectory: "display",
                pixi: "7",
                help: false,
                version: false,
            },
            true,
            { question: async () => "", close: () => undefined },
        ),
        { targetDirectory: "display", pixi: "7", backend: "webgl" },
    );
    await assert.rejects(
        resolveCliArguments(
            {
                targetDirectory: "display",
                pixi: "7",
                backend: "webgpu",
                help: false,
                version: false,
            },
            false,
        ),
        /PixiJS 7 supports only the WebGL backend/,
    );
});

test("quickboot generates version-specific projects without credentials", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "create-pixi-native-"));
    try {
        for (const [
            directory,
            pixi,
            backend,
            importPath,
            pixiPackage,
            pixiVersion,
        ] of [
            [
                "display-v8",
                "8",
                "webgl",
                "@matjazprijatelj/pixi-native",
                "pixi.js",
                "^8.20.0",
            ],
            [
                "display-v7",
                "7",
                "webgl",
                "@matjazprijatelj/pixi-native/pixi7",
                "pixi.js-v7",
                "npm:pixi.js@^7.4.3",
            ],
        ] as const) {
            const target = await createProject({
                targetDirectory: directory,
                pixi,
                backend,
                cwd: fixture,
            });
            const manifest = JSON.parse(
                await readFile(join(target, "package.json"), "utf8"),
            );
            const source = await readFile(join(target, "src", "main.ts"), "utf8");
            const npmrc = await readFile(join(target, ".npmrc"), "utf8");
            assert.equal(
                manifest.dependencies["@matjazprijatelj/pixi-native"],
                PIXI_NATIVE_VERSION,
            );
            assert.equal(manifest.dependencies[pixiPackage], pixiVersion);
            assert.deepEqual(
                Object.keys(manifest.dependencies).filter((name) =>
                    name.startsWith("pixi.js"),
                ),
                [pixiPackage],
            );
            assert.equal(manifest.devDependencies.prettier, "3.9.6");
            assert.match(manifest.scripts.dev, /node --watch .*src\/main\.ts/);
            assert.ok(source.includes(`from "${importPath}"`));
            assert.match(npmrc, /\$\{GITHUB_PACKAGES_TOKEN\}/);
            assert.doesNotMatch(npmrc, /github_pat_|ghp_/);
            assert.ok(
                (await readFile(join(target, "assets", "pixi-native.png"))).length > 0,
            );
            execFileSync(
                process.execPath,
                [
                    resolve(REPOSITORY_ROOT, "node_modules/prettier/bin/prettier.cjs"),
                    "--check",
                    ".",
                ],
                { cwd: target, stdio: "pipe" },
            );
        }
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

test("quickboot refuses non-empty targets", async () => {
    const fixture = await mkdtemp(join(tmpdir(), "create-pixi-native-"));
    const target = join(fixture, "existing");
    try {
        await mkdir(target);
        await writeFile(join(target, "keep.txt"), "keep\n");
        await assert.rejects(
            createProject({
                targetDirectory: target,
                pixi: "8",
                backend: "webgpu",
            }),
            /Target directory is not empty/,
        );
        assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep\n");
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});
