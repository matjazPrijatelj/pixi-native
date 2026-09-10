# Deployment

## Package set

Runtime releases publish one facade package and two platform packages in
lockstep:

- `@matjash/pixi-native`
- `@matjash/pixi-native-win32-x64`
- `@matjash/pixi-native-linux-x64`

`@matjash/create-pixi-native` has an independent release version and
release tag.

Install the facade and the selected Pixi peer. The facade's optional native
dependencies select the package for the current operating system and x64
architecture:

```sh
pnpm add @matjash/pixi-native pixi.js@^8.20.0
# PixiJS 7 instead:
pnpm add @matjash/pixi-native pixi.js-v7@npm:pixi.js@^7.4.3
```

The generator creates PixiJS 7 or 8 TypeScript projects. It has no runtime
dependencies and works on both supported platforms.

## npm installation

All published packages are public on npm. Consumers do not need registry
configuration or credentials.

Create a starter project:

```sh
pnpm dlx @matjash/create-pixi-native my-display --pixi 8 --backend webgpu
```

The root import and `/pixi8` use PixiJS 8. `/pixi7` uses PixiJS 7. Run displays
that use different Pixi majors in separate Node.js processes so their Pixi
singletons, extensions, caches, and plugins cannot cross process boundaries.

## Release archives

Run packaging on each target operating system from the full development
installation:

```sh
pnpm pack:dist
```

The command checks types and tests, compiles the TypeScript packages, validates
native artifacts, creates npm archives and SHA-256 files, and installs the
archives into a fresh production consumer. It uses existing native addons and
FFmpeg binaries. It does not run a native build.

Each host builds and tests the facade and its native archive. The Windows
manifest contributes the facade and Windows native archive. The Linux manifest
contributes the Linux native archive. Both manifests must contain the same
runtime version and source fingerprint.

Pack and validate the independently versioned generator separately:

```sh
pnpm pack:generator
```

This produces an archive matching the generator's independent package version
and its package-specific release manifest. It checks the packed CLI version and
verifies representative PixiJS 7 and 8 projects in fresh temporary consumers.
The current generator release is `0.1.4`; both generated Pixi majors target
runtime `0.1.2`.

From Windows, the complete Linux pass can be repeated in an isolated WSL
checkout after the Windows archive exists:

```powershell
pnpm pack:dist
pnpm pack:dist:linux:wsl
```

The WSL helper downloads a pinned Node.js 24 binary when necessary, copies the
current tracked and untracked source files, stages the existing Linux native
artifacts, installs Linux dependencies, and runs the same package validation.
It copies the Linux archive and manifest back to `artifacts/` and requires the
Linux-built facade to match the Windows facade byte for byte. If FFmpeg reports
missing shared libraries, install them in WSL or pass their directory with
`-LinuxLibraryPath`. The helper never invokes `native:build`.

Do not copy the development checkout's pnpm-linked `node_modules` into a
release. Create a fresh production installation so JavaScript, `.node` addons,
DLLs, and FFmpeg programs are physical files under the launcher root.

## Release commit and tags

Review and stage the source, documentation, tests, three release manifests,
four npm archives, and their checksum files. For this combined npm migration,
both release tags must point to the same final commit:

```powershell
git diff --cached --check
git diff --cached --stat
git commit -m "release(npm): publish @matjash packages"
git tag -a v0.1.2 -m "pixi-native 0.1.2"
git tag -a create-pixi-native-v0.1.4 -m "create-pixi-native 0.1.4"
git push origin main
git push origin v0.1.2
git push origin create-pixi-native-v0.1.4
```

## Publishing

Sign in as the `matjash` npm user with 2FA enabled. The runtime publisher
requires a clean `v0.1.2` release commit, both platform manifests, all three
runtime archives, and matching checksums. It uses an isolated cache, the
standard npm user credentials, and an explicit public npm registry:

```powershell
npm login --registry https://registry.npmjs.org
npm whoami --registry https://registry.npmjs.org
```

Run the non-publishing preflight, publish the runtime packages, and verify that
their immutable registry digests match the local archives:

```sh
pnpm publish:npm:check
pnpm publish:npm
pnpm publish:npm:check
```

Then publish and verify the independently versioned generator:

```sh
pnpm publish:generator:npm:check
pnpm publish:generator:npm
pnpm publish:generator:npm:check
```

### Generator release runbook

The generator has its own version, archive, release manifest, and
`create-pixi-native-v<version>` tag. It can be released without rebuilding or
publishing the runtime/native packages. Never run `native:build` as part of this
workflow.

Use Node.js 24 LTS and pnpm 9.15.9. Start from the repository root with all
intended generator changes present. Update these version references before
packing:

- `packages/create-pixi-native/package.json`
- `GENERATOR_VERSION` in `packages/create-pixi-native/src/generator.ts`
- generator-version assertions in the focused release tests
- the generator version in `packages/create-pixi-native/README.md`
- `HISTORY.md`

For the current patch, every generator version reference is `0.1.4`; the
separate `PIXI_NATIVE_VERSION` is `0.1.2`.

Pack and validate the generator first:

```powershell
$generatorVersion = (Get-Content packages/create-pixi-native/package.json |
    ConvertFrom-Json).version
$generatorTag = "create-pixi-native-v$generatorVersion"
$generatorArchive = "artifacts/matjash-create-pixi-native-$generatorVersion.tgz"

pnpm pack:generator
git status --short
```

`pack:generator` must finish successfully and create the archive, its
`.sha256` file, and `artifacts/release-manifest-create-pixi-native.json`. Review
the changes, then stage only the generator release sources, documentation,
tests, and generated release outputs:

```powershell
git add -- HISTORY.md `
    docs/deployment.md `
    packages/create-pixi-native `
    scripts/pack-generator.mjs `
    tests/create-pixi-native.test.ts `
    tests/release-packages.test.ts `
    artifacts/release-manifest-create-pixi-native.json `
    $generatorArchive `
    "$generatorArchive.sha256"

git diff --cached --check
git diff --cached --stat
git commit -m "release(create-pixi-native): $generatorVersion"
git tag -a $generatorTag -m "create-pixi-native $generatorVersion"
```

The publisher requires a clean working tree and the generator tag on `HEAD`.
Push the release commit and tag before publishing:

```powershell
git push origin main
git push origin $generatorTag
```

Run the non-publishing registry preflight, then publish only when it reports
that the exact generator archive is ready:

```powershell
pnpm publish:generator:npm:check
pnpm publish:generator:npm
pnpm publish:generator:npm:check
```

The final check must report that
`@matjash/create-pixi-native@<version>` already matches.

Verify the published package from a new directory with an explicit version.
Existing generated projects are not updated when a new generator is released:

```powershell
cd C:\Work\pixi-playground
pnpm dlx "@matjash/create-pixi-native@$generatorVersion" `
    release-smoke --pixi 8 --backend webgl
cd release-smoke
pnpm install
pnpm dev
```

Interpret the preflight result carefully:

- `is ready to publish` means the version is absent and the archive can be
  published.
- `already matches` means that exact archive is already published; do not
  publish it again.
- `exists with different content` means the registry version is immutable.
  Increment the generator version, repack, commit, and create a new tag.
- `SEC_E_NO_CREDENTIALS` during `git push` or `git ls-remote` is a Git
  credential failure, not evidence that npm publication succeeded or failed.

The publisher passes `--access public` for every package. The source repository
may remain private, and package consumers do not need registry credentials.

## Platform contents

| Capability         | Windows 11 x64                          | Linux x64                       |
| ------------------ | --------------------------------------- | ------------------------------- |
| PixiJS 8 WebGPU    | D3D12                                   | Vulkan                          |
| PixiJS 8 WebGL     | GLFW/OpenGL ES                          | GLFW/OpenGL ES                  |
| PixiJS 7 WebGL     | GLFW/OpenGL ES                          | GLFW/OpenGL ES                  |
| Window bridge      | Native window addon                     | Native window addon             |
| Audio output       | Native miniaudio/WASAPI addon          | Native miniaudio/PulseAudio or ALSA addon |
| Video acceleration | D3D11VA with CPU fallback               | VA-API with CPU fallback        |
| Media tools        | Packaged `ffmpeg.exe` and `ffprobe.exe` | Packaged `ffmpeg` and `ffprobe` |

Each native package includes the pinned FFmpeg corresponding-source archive and
its SHA-256 checksum under `third_party/`.

## Current limitations

- Linux WebGPU transparency depends on compositor surface capabilities and
  falls back to an opaque surface when premultiplied alpha is unavailable.
- Transparent windows remain pointer-active in transparent areas.
- Native video outputs SDR BT.709 limited-range NV12 and still copies decoder
  output before GPU sampling.
- Live video is non-seekable and supports playback rate `1`.
- The runtime provides no WebView or browser renderer fallback.

See [Third-party notices](../THIRD_PARTY_NOTICES.md) for native binary and
FFmpeg redistribution terms.
