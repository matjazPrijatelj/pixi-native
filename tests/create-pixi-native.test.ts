import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Image as Node3DImage } from "@node-3d/core";
import { parseCliArguments, resolveCliArguments } from "../packages/create-pixi-native/src/cli.ts";
import {
    GENERATOR_VERSION,
    PIXI_NATIVE_VERSION,
    createProject,
} from "../packages/create-pixi-native/src/generator.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("quickboot parses explicit Pixi and backend options", () => {
    assert.deepEqual(parseCliArguments(["display", "--pixi", "8", "--backend=webgpu"]), {
        targetDirectory: "display",
        pixi: "8",
        backend: "webgpu",
        animation: undefined,
        help: false,
        version: false,
    });
    assert.throws(() => parseCliArguments(["display", "--pixi", "9"]), /--pixi must be 7 or 8/);
    assert.throws(
        () => parseCliArguments(["display", "--animation", "css"]),
        /--animation must be ticker or gsap/,
    );
    assert.equal(parseCliArguments(["display", "--animation=gsap"]).animation, "gsap");
});

test("quickboot keeps generator and runtime versions independent", () => {
    assert.equal(GENERATOR_VERSION, "0.1.4");
    assert.equal(PIXI_NATIVE_VERSION, "0.1.2");
    assert.equal(
        execFileSync(
            process.execPath,
            [resolve(REPOSITORY_ROOT, "packages/create-pixi-native/src/cli.ts"), "--version"],
            { encoding: "utf8" },
        ).trim(),
        GENERATOR_VERSION,
    );
});

test("quickboot interactive defaults select PixiJS 8 WebGPU", async () => {
    const answers = ["", "", ""];
    const options = await resolveCliArguments({ help: false, version: false }, true, {
        question: async () => answers.shift() ?? "",
        close: () => undefined,
    });
    assert.deepEqual(options, {
        targetDirectory: "pixi-native-app",
        pixi: "8",
        backend: "webgpu",
        animation: "ticker",
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
        {
            targetDirectory: "display",
            pixi: "7",
            backend: "webgl",
            animation: "ticker",
        },
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
        for (const [directory, pixi, backend, animation, importPath, pixiPackage, pixiVersion] of [
            [
                "display-v8",
                "8",
                "webgl",
                "ticker",
                "@matjash/pixi-native",
                "pixi.js",
                "^8.20.0",
            ],
            [
                "display-v7",
                "7",
                "webgl",
                "ticker",
                "@matjash/pixi-native/pixi7",
                "pixi.js-v7",
                "npm:pixi.js@^7.4.3",
            ],
            [
                "display-v8-gsap",
                "8",
                "webgpu",
                "gsap",
                "@matjash/pixi-native",
                "pixi.js",
                "^8.20.0",
            ],
            [
                "display-v7-gsap",
                "7",
                "webgl",
                "gsap",
                "@matjash/pixi-native/pixi7",
                "pixi.js-v7",
                "npm:pixi.js@^7.4.3",
            ],
        ] as const) {
            const target = await createProject({
                targetDirectory: directory,
                pixi,
                backend,
                animation,
                cwd: fixture,
            });
            const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
            const source = await readFile(join(target, "src", "main.ts"), "utf8");
            const animationSource = await readFile(
                join(target, "src", "backgroundAnimation.ts"),
                "utf8",
            );
            const tsconfig = JSON.parse(await readFile(join(target, "tsconfig.json"), "utf8"));
            assert.equal(
                manifest.dependencies["@matjash/pixi-native"],
                PIXI_NATIVE_VERSION,
            );
            assert.equal(manifest.dependencies[pixiPackage], pixiVersion);
            assert.equal(manifest.dependencies.gsap, animation === "gsap" ? "^3.15.0" : undefined);
            assert.deepEqual(
                Object.keys(manifest.dependencies).filter((name) => name.startsWith("pixi.js")),
                [pixiPackage],
            );
            assert.equal(manifest.devDependencies.prettier, "3.9.6");
            assert.match(manifest.scripts.dev, /node --watch .*src\/main\.ts/);
            assert.ok(source.includes(`from "${importPath}"`));
            assert.match(source, /from "\.\/backgroundAnimation\.ts"/);
            assert.equal(tsconfig.compilerOptions.rewriteRelativeImportExtensions, true);
            assert.match(source, /assets\/pixi-hero\.png/);
            assert.ok(animationSource.includes(`from "${importPath}"`));
            if (animation === "gsap") {
                assert.match(animationSource, /import\("gsap"\)/);
                assert.match(animationSource, /addModalFrameListener/);
            } else {
                assert.doesNotMatch(animationSource, /gsap/i);
                assert.match(animationSource, /ANIMATION_PERIOD_MS = 12_000/);
                assert.match(
                    animationSource,
                    /addDestroyListener\(\(\) => \{\s*runtime\.app\.ticker\.remove/,
                );
            }
            await assert.rejects(readFile(join(target, ".npmrc"), "utf8"), {
                code: "ENOENT",
            });
            assert.deepEqual(await readdir(join(target, "assets")), ["pixi-hero.png"]);
            assert.deepEqual(
                await readFile(join(target, "assets", "pixi-hero.png")),
                await readFile(join(REPOSITORY_ROOT, "pixi-hero.png")),
            );
            if (pixi === "8" && backend === "webgl" && animation === "ticker") {
                const hero = await Node3DImage.loadAsync(
                    join(target, "assets", "pixi-hero.png"),
                );
                assert.equal(hero.width, 1279);
                assert.equal(hero.height, 720);
            }
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
