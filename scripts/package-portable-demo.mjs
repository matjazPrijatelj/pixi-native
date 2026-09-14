import { spawnSync } from "node:child_process";
import {
    chmod,
    copyFile,
    cp,
    mkdir,
    open,
    readFile,
    readdir,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_VERSION = "24.15.0";
const TARGETS = {
    win32: {
        arch: "x64",
        nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
        nodeExecutable: "node.exe",
        npmCli: "node_modules/npm/bin/npm-cli.js",
        nativePackage: "@matjash/pixi-native-win32-x64",
        nativeArchivePrefix: "matjash-pixi-native-win32-x64-",
    },
    linux: {
        arch: "x64",
        nodeArchive: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
        nodeExecutable: "bin/node",
        npmCli: "lib/node_modules/npm/bin/npm-cli.js",
        nativePackage: "@matjash/pixi-native-linux-x64",
        nativeArchivePrefix: "matjash-pixi-native-linux-x64-",
    },
};

const IMPORT_REPLACEMENTS = [
    ["@pixi-native/core", "@matjash/pixi-native/core"],
    ["@pixi-native/pixi8", "@matjash/pixi-native/pixi8"],
];

export function rewritePortableDemoImports(source) {
    let rewritten = source;
    for (const [workspaceName, publicName] of IMPORT_REPLACEMENTS) {
        rewritten = rewritten.replaceAll(workspaceName, publicName);
    }
    return rewritten;
}

export function shouldIncludePortableInput(relativePath) {
    const normalized = relativePath.replaceAll("\\", "/");
    return (
        normalized === ".env.example" ||
        normalized === "src/dev-runner.ts" ||
        normalized === "src/demo" ||
        normalized.startsWith("src/demo/") ||
        normalized === "scripts/analyze-memory-info.mjs" ||
        normalized === "scripts/run-native-memory-isolation.mjs"
    );
}

export function createPortablePackageManifest(options) {
    const {
        platform,
        runtimeVersion,
        facadeArchiveName,
        nativeArchiveName,
        pixiVersion,
        gsapVersion,
    } = options;
    const target = TARGETS[platform];
    if (!target)
        throw new Error(`Unsupported portable demo platform: ${platform}`);
    return {
        name: "pixi-native-portable-demo",
        version: runtimeVersion,
        private: true,
        type: "module",
        engines: { node: ">=24.13.0 <25" },
        dependencies: {
            "@matjash/pixi-native": `file:vendor/${facadeArchiveName}`,
            [target.nativePackage]: `file:vendor/${nativeArchiveName}`,
            gsap: gsapVersion,
            "pixi.js": pixiVersion,
        },
    };
}

async function main() {
    const platform = readArgument("--platform") ?? process.platform;
    const target = TARGETS[platform];
    if (!target) {
        throw new Error("Use --platform=win32 or --platform=linux");
    }
    if (process.platform !== platform) {
        throw new Error(
            `${platform} portable dependencies must be installed on ${platform}; ` +
                "use the Linux WSL packaging command from Windows.",
        );
    }
    if (process.arch !== target.arch) {
        throw new Error(
            `Portable demo packaging requires ${platform}-${target.arch}`,
        );
    }
    if (process.versions.node !== NODE_VERSION) {
        throw new Error(
            `Package the portable demo with Node.js ${NODE_VERSION}`,
        );
    }

    const rootManifest = JSON.parse(
        await readFile(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
    );
    const runtimeManifest = JSON.parse(
        await readFile(
            resolve(REPOSITORY_ROOT, "packages/pixi-native/package.json"),
            "utf8",
        ),
    );
    const installedGsapManifest = JSON.parse(
        await readFile(
            resolve(REPOSITORY_ROOT, "node_modules/gsap/package.json"),
            "utf8",
        ),
    );
    const runtimeVersion = runtimeManifest.version;
    const artifactsRoot = resolve(REPOSITORY_ROOT, "artifacts");
    const facadeArchive = resolve(
        artifactsRoot,
        `matjash-pixi-native-${runtimeVersion}.tgz`,
    );
    const nativeArchive = resolve(
        artifactsRoot,
        `${target.nativeArchivePrefix}${runtimeVersion}.tgz`,
    );
    await requireFile(facadeArchive);
    await requireFile(nativeArchive);

    const stageRoot = resolve(
        REPOSITORY_ROOT,
        ".tmp",
        `pixi-native-demo-${platform}-${target.arch}`,
    );
    const appRoot = resolve(stageRoot, "pixi-native-demo");
    await rm(stageRoot, { recursive: true, force: true });
    await mkdir(appRoot, { recursive: true });

    await copyDemoInputs(appRoot);
    const vendorRoot = resolve(appRoot, "vendor");
    await mkdir(vendorRoot, { recursive: true });
    await copyFile(facadeArchive, resolve(vendorRoot, basename(facadeArchive)));
    await copyFile(nativeArchive, resolve(vendorRoot, basename(nativeArchive)));

    const portableManifest = createPortablePackageManifest({
        platform,
        runtimeVersion,
        facadeArchiveName: basename(facadeArchive),
        nativeArchiveName: basename(nativeArchive),
        pixiVersion: rootManifest.devDependencies["pixi.js"],
        gsapVersion: installedGsapManifest.version,
    });
    await writeFile(
        resolve(appRoot, "package.json"),
        `${JSON.stringify(portableManifest, null, 2)}\n`,
        "utf8",
    );
    await writeLaunchers(appRoot, platform);
    await writeFile(
        resolve(appRoot, "README.txt"),
        createReadme(platform),
        "utf8",
    );

    const suppliedNodeRoot = readArgument("--node-root");
    const nodeRoot = suppliedNodeRoot
        ? resolve(suppliedNodeRoot)
        : await ensureNodeDistribution(target);
    await stagePortableNode(appRoot, nodeRoot, target, platform);
    await installProductionDependencies(appRoot, nodeRoot, target, platform);
    await rm(resolve(appRoot, "node_modules", ".bin"), {
        recursive: true,
        force: true,
    });
    await validatePortableDemo(appRoot, platform, target);

    const archivePath = resolve(
        artifactsRoot,
        `pixi-native-demo-${runtimeVersion}-${platform}-${target.arch}.zip`,
    );
    await rm(archivePath, { force: true });
    await writeStoredZip(appRoot, archivePath, "pixi-native-demo");
    const archiveHash = await sha256File(archivePath);
    await writeFile(
        `${archivePath}.sha256`,
        `${archiveHash}  ${basename(archivePath)}\n`,
    );
    console.log(`Portable demo: ${archivePath}`);
    console.log(`SHA-256: ${archiveHash}`);
}

function readArgument(name) {
    const prefix = `${name}=`;
    return process.argv
        .find((value) => value.startsWith(prefix))
        ?.slice(prefix.length);
}

async function requireFile(path) {
    const fileStat = await stat(path).catch(() => null);
    if (!fileStat?.isFile())
        throw new Error(`Missing portable demo input: ${path}`);
}

async function copyDemoInputs(appRoot) {
    const inputs = [
        ".env.example",
        "src/dev-runner.ts",
        "src/demo",
        "scripts/analyze-memory-info.mjs",
        "scripts/run-native-memory-isolation.mjs",
    ];
    for (const input of inputs) {
        const source = resolve(REPOSITORY_ROOT, input);
        const destination = resolve(appRoot, input);
        if (!shouldIncludePortableInput(input)) {
            throw new Error(`Refusing unexpected portable input: ${input}`);
        }
        await mkdir(dirname(destination), { recursive: true });
        await cp(source, destination, { recursive: true, force: true });
    }
    // The portable distribution exposes the selected PixiJS 8 WebGPU/WebGL demo only.
    await rm(resolve(appRoot, "src/demo/v7"), { recursive: true, force: true });
    await rewriteTypescriptTree(resolve(appRoot, "src"));
}

async function rewriteTypescriptTree(root) {
    for (const path of await listFiles(root)) {
        if (!path.endsWith(".ts")) continue;
        const source = await readFile(path, "utf8");
        const rewritten = rewritePortableDemoImports(source);
        if (rewritten !== source) await writeFile(path, rewritten, "utf8");
    }
}

async function writeLaunchers(appRoot, platform) {
    const windows = {
        "start-webgpu.cmd": launcherCmd(
            "src\\dev-runner.ts webgpu --unique-memory-log",
        ),
        "start-webgl.cmd": launcherCmd(
            "src\\dev-runner.ts webgl --unique-memory-log",
        ),
        "run-memory-test.cmd": launcherCmd(
            "scripts\\run-native-memory-isolation.mjs --unique-output %*",
        ),
        "analyze-memory.cmd":
            "@echo off\r\n" +
            'cd /d "%~dp0"\r\n' +
            'if "%~1"=="" (\r\n' +
            '  "%~dp0runtime\\node.exe" scripts\\analyze-memory-info.mjs\r\n' +
            ") else (\r\n" +
            '  "%~dp0runtime\\node.exe" scripts\\analyze-memory-info.mjs "%~1"\r\n' +
            ")\r\n",
    };
    const linux = {
        "start-webgpu.sh": launcherSh(
            "src/dev-runner.ts webgpu --unique-memory-log",
        ),
        "start-webgl.sh": launcherSh(
            "src/dev-runner.ts webgl --unique-memory-log",
        ),
        "run-memory-test.sh": launcherSh(
            'scripts/run-native-memory-isolation.mjs --unique-output "$@"',
        ),
        "analyze-memory.sh":
            "#!/usr/bin/env sh\n" +
            "set -eu\n" +
            'cd "$(dirname "$0")"\n' +
            'if [ "$#" -eq 0 ]; then\n' +
            '  exec "./runtime/node" scripts/analyze-memory-info.mjs\n' +
            "fi\n" +
            'exec "./runtime/node" scripts/analyze-memory-info.mjs "$1"\n',
    };
    const launchers = platform === "win32" ? windows : linux;
    for (const [name, contents] of Object.entries(launchers)) {
        const path = resolve(appRoot, name);
        await writeFile(path, contents, "utf8");
        if (platform === "linux") await chmod(path, 0o755);
    }
}

function launcherCmd(argumentsText) {
    return `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" --enable-source-maps ${argumentsText}\r\n`;
}

function launcherSh(argumentsText) {
    return `#!/usr/bin/env sh\nset -eu\ncd "$(dirname "$0")"\nexec "./runtime/node" --enable-source-maps ${argumentsText}\n`;
}

function createReadme(platform) {
    const start =
        platform === "win32"
            ? "start-webgpu.cmd or start-webgl.cmd"
            : "./start-webgpu.sh or ./start-webgl.sh";
    const soak =
        platform === "win32"
            ? "run-memory-test.cmd --duration-seconds 7200 --backend=both"
            : "./run-memory-test.sh --duration-seconds 7200 --backend=both";
    return (
        `PIXI NATIVE PORTABLE DEMO\n\n` +
        `1. If needed, copy .env.example to .env and modify the settings.\n` +
        `2. To run the interactive demo, execute: ${start}\n` +
        `3. To run a two-hour comparison test, execute:\n   ${soak}\n` +
        `4. Each instance gets its own memory log in the logs directory.\n` +
        `5. If no path is specified, the analyzer selects the latest memory log.\n\n` +
        `The .env file from the development machine is not included in the distribution.\n` +
        `Portable Node.js ${NODE_VERSION} is located in the runtime directory.\n`
    );
}

async function ensureNodeDistribution(target) {
    const cacheRoot = resolve(REPOSITORY_ROOT, ".tmp", "portable-node");
    const archivePath = resolve(cacheRoot, target.nodeArchive);
    const extractedRoot = resolve(
        cacheRoot,
        target.nodeArchive.replace(/\.(zip|tar\.xz)$/u, ""),
    );
    const executablePath = resolve(extractedRoot, target.nodeExecutable);
    if (await isFile(executablePath)) return extractedRoot;

    await mkdir(cacheRoot, { recursive: true });
    const baseUrl = `https://nodejs.org/dist/v${NODE_VERSION}`;
    const checksums = await downloadText(`${baseUrl}/SHASUMS256.txt`);
    const checksumLine = checksums
        .split(/\r?\n/u)
        .find((line) => line.trim().endsWith(`  ${target.nodeArchive}`));
    if (!checksumLine) {
        throw new Error(`Node checksum is missing for ${target.nodeArchive}`);
    }
    const expectedHash = checksumLine.trim().split(/\s+/u)[0];
    if (!(await isFile(archivePath))) {
        await downloadFile(`${baseUrl}/${target.nodeArchive}`, archivePath);
    }
    const actualHash = await sha256File(archivePath);
    if (actualHash !== expectedHash) {
        throw new Error(
            `Node archive checksum mismatch for ${target.nodeArchive}`,
        );
    }
    await rm(extractedRoot, { recursive: true, force: true });
    if (process.platform === "win32") {
        run("tar.exe", ["-xf", archivePath, "-C", cacheRoot]);
    } else {
        run("tar", ["-xJf", archivePath, "-C", cacheRoot]);
    }
    await requireFile(executablePath);
    return extractedRoot;
}

async function downloadText(url) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Download failed (${response.status}): ${url}`);
    return response.text();
}

async function downloadFile(url, destination) {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`Download failed (${response.status}): ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, bytes);
}

async function stagePortableNode(appRoot, nodeRoot, target, platform) {
    const runtimeRoot = resolve(appRoot, "runtime");
    await mkdir(runtimeRoot, { recursive: true });
    const sourceExecutable = resolve(nodeRoot, target.nodeExecutable);
    const destinationExecutable = resolve(
        runtimeRoot,
        platform === "win32" ? "node.exe" : "node",
    );
    await requireFile(sourceExecutable);
    await copyFile(sourceExecutable, destinationExecutable);
    if (platform === "linux") await chmod(destinationExecutable, 0o755);
    await copyFile(
        resolve(nodeRoot, "LICENSE"),
        resolve(runtimeRoot, "NODE-LICENSE"),
    );
}

async function installProductionDependencies(
    appRoot,
    nodeRoot,
    target,
    platform,
) {
    const node = resolve(nodeRoot, target.nodeExecutable);
    const npmCli = resolve(nodeRoot, target.npmCli);
    await requireFile(node);
    await requireFile(npmCli);
    const cache = resolve(
        REPOSITORY_ROOT,
        ".tmp",
        `portable-demo-npm-${platform}`,
    );
    await mkdir(cache, { recursive: true });
    run(
        node,
        [
            npmCli,
            "install",
            "--omit=dev",
            "--include=optional",
            "--no-audit",
            "--no-fund",
            "--no-package-lock",
            "--cache",
            cache,
        ],
        { cwd: appRoot },
    );
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: "inherit",
        shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} exited with code ${result.status}`);
    }
}

async function validatePortableDemo(appRoot, platform, target) {
    if (await isFile(resolve(appRoot, ".env"))) {
        throw new Error("Portable demo must not contain a local .env file");
    }
    const required = [
        ".env.example",
        "src/dev-runner.ts",
        "src/demo/v8/main.ts",
        "scripts/analyze-memory-info.mjs",
        "scripts/run-native-memory-isolation.mjs",
        platform === "win32" ? "runtime/node.exe" : "runtime/node",
        `node_modules/${target.nativePackage}/package.json`,
        "node_modules/@matjash/pixi-native/package.json",
        "node_modules/pixi.js/package.json",
        "node_modules/gsap/package.json",
    ];
    for (const path of required) await requireFile(resolve(appRoot, path));

    for (const path of await listFiles(resolve(appRoot, "src"))) {
        if (!path.endsWith(".ts")) continue;
        const source = await readFile(path, "utf8");
        if (source.includes("@pixi-native/")) {
            throw new Error(`Unresolved workspace import in ${path}`);
        }
    }
    const wrongPackage =
        platform === "win32"
            ? "@matjash/pixi-native-linux-x64"
            : "@matjash/pixi-native-win32-x64";
    if (await isDirectory(resolve(appRoot, "node_modules", wrongPackage))) {
        throw new Error(
            `Portable demo contains the wrong native package: ${wrongPackage}`,
        );
    }
}

async function listFiles(root) {
    const files = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) files.push(...(await listFiles(path)));
        else if (entry.isFile() || entry.isSymbolicLink()) files.push(path);
    }
    return files;
}

async function isFile(path) {
    return (await stat(path).catch(() => null))?.isFile() ?? false;
}

async function isDirectory(path) {
    return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function sha256File(path) {
    const bytes = await readFile(path);
    return createHash("sha256").update(bytes).digest("hex");
}

const CRC_TABLE = createCrcTable();

function createCrcTable() {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index++) {
        crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** Writes a portable ZIP without relying on platform archive tools. */
async function writeStoredZip(sourceRoot, archivePath, archiveRoot) {
    const output = await open(archivePath, "w");
    const centralEntries = [];
    let offset = 0;
    try {
        const files = await listFiles(sourceRoot);
        files.sort((left, right) => left.localeCompare(right));
        for (const path of files) {
            const bytes = await readFile(path);
            if (bytes.length > 0xffffffff) {
                throw new Error(`ZIP64 is not supported: ${path}`);
            }
            const pathStat = await stat(path);
            const relativePath = relative(sourceRoot, path)
                .split(sep)
                .join("/");
            const name = Buffer.from(`${archiveRoot}/${relativePath}`, "utf8");
            const checksum = crc32(bytes);
            const deflated = deflateRawSync(bytes, { level: 6 });
            const compressed =
                deflated.length < bytes.length ? deflated : bytes;
            const method = compressed === deflated ? 8 : 0;
            const { dosDate, dosTime } = toDosDate(pathStat.mtime);
            const localHeader = Buffer.alloc(30);
            localHeader.writeUInt32LE(0x04034b50, 0);
            localHeader.writeUInt16LE(20, 4);
            localHeader.writeUInt16LE(0x0800, 6);
            localHeader.writeUInt16LE(method, 8);
            localHeader.writeUInt16LE(dosTime, 10);
            localHeader.writeUInt16LE(dosDate, 12);
            localHeader.writeUInt32LE(checksum, 14);
            localHeader.writeUInt32LE(compressed.length, 18);
            localHeader.writeUInt32LE(bytes.length, 22);
            localHeader.writeUInt16LE(name.length, 26);
            localHeader.writeUInt16LE(0, 28);
            await output.write(localHeader);
            await output.write(name);
            await output.write(compressed);
            centralEntries.push({
                name,
                checksum,
                compressedSize: compressed.length,
                size: bytes.length,
                method,
                dosDate,
                dosTime,
                offset,
                mode: pathStat.mode,
            });
            offset += localHeader.length + name.length + compressed.length;
        }

        const centralOffset = offset;
        for (const entry of centralEntries) {
            const header = Buffer.alloc(46);
            header.writeUInt32LE(0x02014b50, 0);
            header.writeUInt16LE((3 << 8) | 20, 4);
            header.writeUInt16LE(20, 6);
            header.writeUInt16LE(0x0800, 8);
            header.writeUInt16LE(entry.method, 10);
            header.writeUInt16LE(entry.dosTime, 12);
            header.writeUInt16LE(entry.dosDate, 14);
            header.writeUInt32LE(entry.checksum, 16);
            header.writeUInt32LE(entry.compressedSize, 20);
            header.writeUInt32LE(entry.size, 24);
            header.writeUInt16LE(entry.name.length, 28);
            header.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
            header.writeUInt32LE(entry.offset, 42);
            await output.write(header);
            await output.write(entry.name);
            offset += header.length + entry.name.length;
        }
        const centralSize = offset - centralOffset;
        if (centralEntries.length > 0xffff || offset > 0xffffffff) {
            throw new Error("ZIP64 is required for this portable demo archive");
        }
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(centralEntries.length, 8);
        end.writeUInt16LE(centralEntries.length, 10);
        end.writeUInt32LE(centralSize, 12);
        end.writeUInt32LE(centralOffset, 16);
        await output.write(end);
    } finally {
        await output.close();
    }
}

function toDosDate(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
        dosTime:
            (date.getHours() << 11) |
            (date.getMinutes() << 5) |
            Math.floor(date.getSeconds() / 2),
        dosDate:
            ((year - 1980) << 9) |
            ((date.getMonth() + 1) << 5) |
            date.getDate(),
    };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
    await main();
}
