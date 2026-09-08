# Pixi Native

Pixi Native runs PixiJS directly in a native Node.js window without a browser
DOM, WebView, or CEF. Separate PixiJS 7 and PixiJS 8 packages can coexist in one
launcher while every display process loads only its matching Pixi major.

## Packages

| Package                         | Responsibility                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `@pixi-native/core`             | Pixi-neutral lifecycle, runtime, canvas, audio, video, files, and shared WebGL integration |
| `@pixi-native/pixi7`            | PixiJS 7 facade, WebGL renderer, `createApp`, and `VideoSprite`                            |
| `@pixi-native/pixi8`            | PixiJS 8 facade, WebGPU/WebGL renderers, `createApp`, and `VideoSprite`                    |
| `@pixi-native/native-win32-x64` | Windows x64 GPU, window, audio, video, and FFmpeg binaries                                 |

Public entrypoints are deliberate package facades. Repository source paths and
unexported `dist/` files are internal.

## Quick start

Install the neutral runtime, one Pixi facade, and the native platform package:

```sh
pnpm add @pixi-native/core @pixi-native/pixi8 @pixi-native/native-win32-x64
```

```ts
import {
  Assets,
  Sprite,
  createApp,
  createModuleFileAccess,
} from "@pixi-native/pixi8";

const files = createModuleFileAccess(import.meta.url);
const { app, native, destroy } = await createApp({
  backend: "webgpu",
  width: 1280,
  height: 720,
  transparent: true,
});

const character = await Assets.load(
  files.resolvePath("../assets/character.png"),
);
app.stage.addChild(new Sprite(character));
native.window.setPosition(100, 100);

await destroy();
```

PixiJS 8 supports explicit `webgpu` and `webgl` backends. PixiJS 7 uses the
equivalent API from `@pixi-native/pixi7` and is WebGL-only. GSAP is optional and
is installed by the consuming display only when needed.

## Developer documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Application and API](docs/application-and-api.md)
- [Media and files](docs/media-and-files.md)
- [Optional GSAP integration](docs/integrations/gsap.md)
- [Launcher deployment](docs/deployment.md)

The same documentation is included in the core and versioned package tarballs.
The shipped TypeScript declarations remain the authoritative API reference.

## Repository development

Use Node.js 24.13 or newer from the Node.js 24 LTS line and pnpm 9.15.9:

```sh
pnpm install
pnpm typecheck
pnpm test
```

Run one explicit demo backend:

```sh
pnpm dev:webgpu
pnpm dev:webgl
pnpm dev:webgl7
```

The interactive demo covers Sprite, Graphics, normal Text, BitmapText, ticker
animation, native video, native audio, transparency, resizing, and presentation
stability. Use number keys `1`–`9` or left/right to change scenes. The Sprite
scene uses optional GSAP timelines; the demo dependency is development-only.

Native rebuilds require the platform compiler toolchain, CMake, Go, Rust, and
the media prerequisites described by the build scripts. The default development
checkout uses existing native artifacts; do not start a long-running native
build when another one is active.

## Distribution

Create the four private, checksummed packages from the full development install:

```sh
pnpm pack:dist
```

The command performs type checking, tests, TypeScript compilation,
native-artifact validation, package creation, and a fresh production-consumer
test. It does not rebuild native addons or FFmpeg. Generated archives are placed
under `artifacts/`.

Install all four archives once in a shared launcher dependency root when its
display processes may use either Pixi major. See [Deployment](docs/deployment.md)
for the process and platform-package contract.

## Current support

- Node.js 24 on Windows 11 x64
- PixiJS 8.20.0 with WebGPU or WebGL
- PixiJS 7.4.3 with WebGL
- Windows D3D12 WebGPU through the project-owned Dawn addon
- Native Canvas2D, FFmpeg video, and native audio
- Explicit renderer selection with no browser or renderer fallback

The packaged GPU addon currently targets Windows x64. Linux uses a future
`@pixi-native/native-linux-x64` package without changing display imports. See
[Deployment](docs/deployment.md#current-limitations) for current limitations.

This repository and its private packages are `UNLICENSED`. Third-party license
information is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
