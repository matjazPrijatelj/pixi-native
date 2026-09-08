# Deployment

## Package set

A release contains three platform-neutral packages and one native package for
the operating system used to create it:

- `@pixi-native/core`
- `@pixi-native/pixi7`
- `@pixi-native/pixi8`
- `@pixi-native/native-win32-x64` or `@pixi-native/native-linux-x64`

Install the core, each Pixi facade required by the displays, and one matching
native package. Node rejects a native package on the wrong operating system or
architecture.

## Shared launcher layout

A launcher can host displays built with either Pixi major. Install the shared
runtime and platform binaries once in the launcher dependency root, then run
each display as a separate Node.js process:

```text
launcher/
├─ node_modules/
│  ├─ @pixi-native/core
│  ├─ @pixi-native/pixi7
│  ├─ @pixi-native/pixi8
│  └─ @pixi-native/native-<platform>-x64
└─ displays/
   ├─ legacy-pixi7/
   └─ current-pixi8/
```

Each display imports one version facade. Separate processes keep Pixi
singletons, extensions, caches, and plugins from crossing major versions while
sharing one physical copy of the native binaries.

## Registry installation

After the project publishes the packages, install them together in the launcher
root. For a Windows launcher that uses both Pixi versions:

```sh
pnpm add @pixi-native/core @pixi-native/pixi7 @pixi-native/pixi8 @pixi-native/native-win32-x64
```

Use `@pixi-native/native-linux-x64` on Linux.

The project has not published version 0.1.0 to a public registry, and its
packages remain `UNLICENSED`. Choose a project license and update package
publication metadata before an open-source release.

## Release archives

Run packaging on the target operating system from the full development
installation:

```sh
pnpm pack:dist
```

The command runs type checking and tests, compiles the TypeScript packages,
validates native artifacts, creates npm archives and SHA-256 files, and installs
the archives into a fresh production consumer. It uses existing native addons
and FFmpeg binaries. It does not run a native build.

Install every generated `.tgz` required by the launcher in one `pnpm add`
command. Keep the archive versions aligned across core, both Pixi facades, and
the native package.

Do not copy the development checkout's pnpm-linked `node_modules` into a
release. Create a fresh production installation so JavaScript, `.node` addons,
DLLs, and FFmpeg programs are physical files under the launcher root.

## Platform contents

| Capability         | Windows 11 x64                           | Linux x64                       |
| ------------------ | ---------------------------------------- | ------------------------------- |
| PixiJS 8 WebGPU    | D3D12                                    | Vulkan                          |
| PixiJS 8 WebGL     | GLFW/OpenGL ES                           | GLFW/OpenGL ES                  |
| PixiJS 7 WebGL     | GLFW/OpenGL ES                           | GLFW/OpenGL ES                  |
| Window bridge      | Native window addon                      | Native window addon             |
| Audio output       | Native WASAPI addon                      | SDL playback                    |
| Video acceleration | D3D11VA with CPU fallback                | VA-API with CPU fallback        |
| Media tools        | Packaged `ffmpeg.exe` and `ffprobe.exe`  | Packaged `ffmpeg` and `ffprobe` |

The native resolver fails with a target-specific error when the package or a
required addon is missing. It does not load an addon for another platform.

## Current limitations

- Linux WebGPU transparency depends on compositor surface capabilities and
  falls back to an opaque surface when premultiplied alpha is unavailable.
- Transparent windows remain pointer-active in transparent areas.
- Native video outputs SDR BT.709 limited-range NV12 and still copies decoder
  output before GPU sampling.
- Live video is non-seekable and supports playback rate `1`.
- The runtime provides no WebView or browser renderer fallback.

See [Third-party notices](../THIRD_PARTY_NOTICES.md) for the native binary and
FFmpeg redistribution terms.
