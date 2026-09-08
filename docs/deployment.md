# Deployment

## Shared launcher layout

A launcher may contain displays built with either PixiJS major. Install the
shared runtime and platform binaries once in the launcher's dependency root,
then run every display as a separate Node.js process:

```text
launcher/
├─ node_modules/
│  ├─ @pixi-native/core
│  ├─ @pixi-native/pixi7
│  ├─ @pixi-native/pixi8
│  └─ @pixi-native/native-win32-x64
└─ displays/
   ├─ legacy-pixi7/
   └─ current-pixi8/
```

Each display imports only its selected version facade. This prevents Pixi
singletons, extensions, caches, and plugins from crossing major versions while
avoiding duplicate native binaries.

## Private tarballs

The repository produces the four verified packages with:

```sh
pnpm pack:dist
```

Install the generated archives together in the launcher root. Packaging runs
type checking, tests, TypeScript compilation, native-artifact validation,
`npm pack`, and a fresh production-consumer smoke test. It uses existing native
artifacts and does not rebuild native addons or FFmpeg.

Do not copy a development pnpm-linked `node_modules` directory into a release.
Create a fresh production installation so package files and native binaries are
physical and portable.

## Platform packages

`@pixi-native/core`, `@pixi-native/pixi7`, and `@pixi-native/pixi8` are
platform-neutral. Native addons and the packaged FFmpeg runtime belong to a
platform package selected by Node platform and architecture.

The current distribution provides `@pixi-native/native-win32-x64`. Future Linux
support uses `@pixi-native/native-linux-x64` with the same resolver contract;
display imports and Pixi package names do not change.

An unsupported or missing native target fails explicitly during startup. The
runtime does not load a binary built for another operating system and does not
silently switch renderer backends.

## Current limitations

- Packaged WebGPU currently targets Windows x64 and D3D12.
- Linux WebGPU remains unavailable until the project-owned Vulkan addon is
  packaged; Linux WebGL and native media development paths are separate.
- Transparent windows are currently supported on Windows 11 and remain
  input-active in transparent areas.
- Native video outputs SDR BT.709 limited NV12 and is not decoder-to-GPU
  zero-copy.
- Live video is non-seekable and supports playback rate `1` only.
- There is no WebView or browser-renderer fallback.
