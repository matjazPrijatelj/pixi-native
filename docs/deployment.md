# Deployment

## Package set

Runtime releases publish one facade package and two platform packages in
lockstep:

- `@matjazprijatelj/pixi-native`
- `@matjazprijatelj/pixi-native-win32-x64`
- `@matjazprijatelj/pixi-native-linux-x64`

`@matjazprijatelj/create-pixi-native` has an independent release version and
release tag.

Install the facade and the selected Pixi peer. The facade's optional native
dependencies select the package for the current operating system and x64
architecture:

```sh
pnpm add @matjazprijatelj/pixi-native pixi.js@^8.20.0
# PixiJS 7 instead:
pnpm add @matjazprijatelj/pixi-native pixi.js-v7@npm:pixi.js@^7.4.3
```

The generator creates PixiJS 7 or 8 TypeScript projects. It has no runtime
dependencies and works on both supported platforms.

## GitHub Packages installation

GitHub Packages requires authentication for npm installs. Create a classic
personal access token with `read:packages` and expose it as
`GITHUB_PACKAGES_TOKEN`. Add this configuration to the consumer's `.npmrc`:

```ini
@matjazprijatelj:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Create a starter project:

```sh
pnpm dlx @matjazprijatelj/create-pixi-native my-display --pixi 8 --backend webgpu
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

This produces the `0.1.0` generator archive and its package-specific release
manifest, checks the packed CLI version, and verifies that PixiJS 7 and 8
templates contain only their selected Pixi dependency while both target runtime
`0.1.1`. It installs, typechecks, and builds both projects in fresh temporary
consumers outside the workspace.

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

## Publishing

Run the guarded preflight before uploading:

```sh
pnpm publish:github:check
```

Set a classic personal access token with `write:packages` in
`GITHUB_PACKAGES_TOKEN`. The runtime publisher requires a clean `v0.1.1`
release commit, both platform manifests, all three runtime archives, and
matching checksums. It uses an isolated npm configuration and does not print
the token.

Publish with an explicit command:

```sh
pnpm publish:github
```

The generator uses its own `create-pixi-native-v0.1.0` tag and preflight:

```sh
pnpm publish:generator:github:check
pnpm publish:generator:github
```

GitHub creates new packages as private. Change each package page to Public
after publication. The source repository may remain private; package consumers
still need a token for GitHub's npm registry.

## Platform contents

| Capability         | Windows 11 x64                          | Linux x64                       |
| ------------------ | --------------------------------------- | ------------------------------- |
| PixiJS 8 WebGPU    | D3D12                                   | Vulkan                          |
| PixiJS 8 WebGL     | GLFW/OpenGL ES                          | GLFW/OpenGL ES                  |
| PixiJS 7 WebGL     | GLFW/OpenGL ES                          | GLFW/OpenGL ES                  |
| Window bridge      | Native window addon                     | Native window addon             |
| Audio output       | Native WASAPI addon                     | SDL playback                    |
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
