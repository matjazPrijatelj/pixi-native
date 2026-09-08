# Pixi Native

Pixi Native runs PixiJS in a native Node.js window. It provides the small
browser-shaped surface that Pixi needs, then connects Pixi to native WebGPU or
WebGL rendering, window input, Canvas2D, audio, video, and file access. Display
applications do not need a browser, WebView, or CEF process.

> [!WARNING]
> Version 0.1.0 is a pre-release. The repository and its packages remain
> `UNLICENSED`, so the project is not ready for an open-source release until
> the owner chooses and applies a license.

## What is included

- PixiJS 8 with WebGPU or WebGL, plus PixiJS 7 with WebGL.
- Managed native application startup, frame presentation, input, resizing, and
  teardown through `createApp()`.
- Native Canvas2D support for Pixi text, bitmap-font assets, and image loading.
- FFmpeg-backed file and live video with audio, seeking, source replacement,
  reconnect support, statistics, and side-by-side packed alpha.
- A Howler-style native audio API for effects, music, sprites, fades, and
  overlapping voices.
- Module-relative, read-only file helpers for packaged display assets.
- Optional GSAP and PixiPlugin integration, including animation during Windows
  move and resize loops.

Pixi Native implements the browser APIs that Pixi uses. It does not provide
HTML layout, CSS, navigation, browser media elements, or a general-purpose DOM.

## Packages

| Package                         | Contents                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `@pixi-native/core`             | Pixi-neutral runtime, lifecycle, Canvas2D, audio, video, files, and WebGL integration         |
| `@pixi-native/pixi7`            | PixiJS 7 facade, WebGL renderer, `createApp()`, `createRenderer()`, and `VideoSprite`         |
| `@pixi-native/pixi8`            | PixiJS 8 facade, WebGPU/WebGL renderers, `createApp()`, `createRenderer()`, and `VideoSprite` |
| `@pixi-native/native-win32-x64` | Windows x64 GPU, window, audio, video, D3DCompiler, and FFmpeg binaries                       |
| `@pixi-native/native-linux-x64` | Linux x64 GPU, window, video, and FFmpeg binaries                                             |

Applications should import Pixi and native helpers from one version facade.
Repository source paths and unexported `dist/` files are internal.

## Support matrix

Version 0.1.0 targets PixiJS 8.20.0 and PixiJS 7.4.3.

| Platform       | PixiJS 8 WebGPU | PixiJS 8 WebGL | PixiJS 7 WebGL | Audio         | Video                  |
| -------------- | ---------------- | --------------- | --------------- | ------------- | ---------------------- |
| Windows 11 x64 | D3D12            | GLFW/OpenGL ES  | GLFW/OpenGL ES | Native WASAPI | FFmpeg, D3D11VA or CPU |
| Linux x64      | Vulkan           | GLFW/OpenGL ES  | GLFW/OpenGL ES | SDL playback  | FFmpeg, VA-API or CPU  |

Both platforms use explicit renderer selection and fail when the requested
backend or native package is unavailable. The runtime does not switch to a
browser renderer or another backend.

## Install

Use Node.js 24.13 or newer from the Node.js 24 LTS line. The repository uses
pnpm 9.15.9.

Install the neutral runtime, one Pixi facade, and the native package for the
target platform. This Windows example uses PixiJS 8:

```sh
pnpm add @pixi-native/core @pixi-native/pixi8 @pixi-native/native-win32-x64
```

Use `@pixi-native/native-linux-x64` on Linux. A launcher that runs PixiJS 7 and
PixiJS 8 displays can install both version facades in one dependency root, but
each display must run in a separate Node.js process and import one Pixi major.

The project has not published these packages to a public registry. Until then,
install the matching `.tgz` files produced by `pnpm pack:dist`. See
[Deployment](docs/deployment.md) for the archive and launcher layout.

## PixiJS 8 quick start

```ts
import {
  Assets,
  Sprite,
  createApp,
  createModuleFileAccess,
} from "@pixi-native/pixi8";

const files = createModuleFileAccess(import.meta.url);
const runtime = await createApp({
  backend: "webgpu",
  width: 1280,
  height: 720,
  title: "Pixi Native",
  transparent: true,
});

const texturePath = files.resolvePath("../assets/character.png");
const texture = await Assets.load(texturePath);
runtime.app.stage.addChild(new Sprite(texture));
runtime.native.window.setPosition(100, 100);

runtime.addDestroyListener(() => Assets.unload(texturePath));
// Call await runtime.destroy() from your application shutdown path.
```

`backend: "webgpu"` selects WebGPU. Use `backend: "webgl"` for PixiJS 8
WebGL. Omitting `backend` selects WebGPU and still does not enable fallback.

## PixiJS 7 quick start

```ts
import { Graphics, createApp } from "@pixi-native/pixi7";

const runtime = await createApp({
  width: 1280,
  height: 720,
  title: "Pixi 7 Native",
});

const shape = new Graphics();
shape.beginFill(0x4f8cff).drawRoundedRect(40, 40, 240, 120, 16).endFill();
runtime.app.stage.addChild(shape);
```

PixiJS 7 uses WebGL. Do not import `pixi.js`, `pixi.js-v7`, or the other Pixi
Native version facade in the same display process.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Application lifecycle and API](docs/application-and-api.md)
- [Media and files](docs/media-and-files.md)
- [GSAP integration](docs/integrations/gsap.md)
- [Deployment and release archives](docs/deployment.md)

The [canonical documentation directory](https://github.com/matjazPrijatelj/pixi-native/tree/main/docs)
lives in this repository. Package tarballs include the same guides. Shipped
TypeScript declarations define the public API.

## Current limitations

- Windows transparency uses the compositor path. Linux transparency depends on
  the active compositor and surface capabilities; WebGPU uses an opaque surface
  when premultiplied alpha is unavailable.
- Transparent pixels still receive pointer input. The public API does not
  provide click-through windows or custom title bars.
- Native video outputs SDR BT.709 limited-range NV12. The decoder-to-GPU path
  still performs a copy.
- Live video sources do not support seeking and require playback rate `1`.
- `maxFps` applies from 24 to 360 FPS when `vsync` is false. With `vsync: true`,
  VSync owns pacing.

## Repository development

```sh
pnpm install
pnpm typecheck
pnpm test
```

Run one demo backend:

```sh
pnpm dev:webgpu
pnpm dev:webgl
pnpm dev:webgl7
```

The demo covers Sprite, Graphics, Text, BitmapText, ticker animation, video,
audio, transparency, resizing, and presentation. Use number keys `1` through
`9` or the arrow keys to change scenes.

Create the platform-specific release archives from the full development
installation:

```sh
pnpm pack:dist
```

This command checks types and tests, compiles the TypeScript packages, validates
native artifacts, creates checksummed archives, and installs them into a fresh
production consumer. It uses existing native addons and FFmpeg binaries.

## Acknowledgements

Pixi Native builds on [PixiJS](https://pixijs.com/),
[Dawn and Tint](https://dawn.googlesource.com/dawn/),
[GLFW](https://www.glfw.org/), and [SDL](https://www.libsdl.org/). The Node.js
integration also uses [@node-3d](https://github.com/node-3d),
[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas),
[napi-rs](https://napi.rs/), [CPAL](https://github.com/RustAudio/cpal), and
[FFmpeg](https://ffmpeg.org/).

Thanks to the maintainers and contributors of those projects. Their work makes
the native renderer, window, canvas, audio, and media layers possible. See
[Third-party notices](THIRD_PARTY_NOTICES.md) for license and redistribution
details.

## License status

Pixi Native 0.1.0 is `UNLICENSED`. Source availability does not grant rights to
use, modify, or redistribute the project. Third-party components retain their
own licenses. Choose a project license and update all package manifests before
publishing this as an open-source package.
