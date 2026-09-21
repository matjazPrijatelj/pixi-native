# Pixi Native

Pixi Native runs PixiJS in a native Node.js window. It provides the small
browser-shaped surface that Pixi needs, then connects Pixi to native WebGPU or
WebGL rendering, window input, Canvas2D, audio, video, and file access. Display
applications do not need a browser, WebView, or CEF process.

> [!NOTE]
> Version 0.2.7 is a pre-release. The API and native package layout may change
> before 1.0.

![Pixi Native architecture and supported platforms](pixi-hero.png)

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

## Package

Install `@matjash/pixi-native`. Its root export uses PixiJS 8. The
`/pixi8`, `/pixi7`, and `/core` subpaths expose the explicit facades and the
Pixi-neutral API. npm installs the matching Windows or Linux native package as
an optional platform dependency.

Applications should import Pixi and native helpers from one version facade.
Repository source paths and unexported `dist/` files are internal.

## Support matrix

Version 0.2.7 targets PixiJS 8.21.0 while retaining the `^8.20.0` peer range,
and targets PixiJS 7.4.3.

| Platform       | PixiJS 8 WebGPU | PixiJS 8 WebGL | PixiJS 7 WebGL | Audio     | Video                  |
| -------------- | --------------- | -------------- | -------------- | --------- | ---------------------- |
| Windows 11 x64 | D3D12           | SDL/ANGLE GLES | SDL/ANGLE GLES | miniaudio | FFmpeg, D3D11VA or CPU |
| Linux x64      | Vulkan          | SDL/EGL GLES   | SDL/EGL GLES   | miniaudio | FFmpeg, VA-API or CPU  |

Both platforms use explicit renderer selection and fail when the requested
backend or native package is unavailable. The runtime does not switch to a
browser renderer or another backend.

Version 0.2.0 removes the exported `setNativeWindowTransparent()` helper.
Select transparency with the `transparent` renderer/application option so the
SDL3 window and requested renderer are configured together.

## Install

Use Node.js 24.13 or newer from the Node.js 24 LTS line. The repository uses
pnpm 12.4.1.

Install the facade package together with the Pixi major used by the display:

```sh
pnpm add @matjash/pixi-native pixi.js@^8.20.0
# PixiJS 7 instead:
pnpm add @matjash/pixi-native pixi.js-v7@npm:pixi.js@^7.4.3
```

npm selects the matching x64 native package. The facade declares both Pixi
majors as optional peers and does not install either one. A launcher that uses
both majors can install both commands' Pixi dependencies, but each display must
run in a separate Node.js process and import one Pixi major.

## Create a starter project

The quickboot package creates a small TypeScript project with Sprite, Graphics,
Text, ticker animation, resize handling, and managed teardown:

```sh
pnpm create @matjash/pixi-native my-display --pixi 8 --backend webgpu
cd my-display
pnpm install
pnpm dev
```

Use `--backend webgl` for PixiJS 8 WebGL. Create a PixiJS 7 project with
`--pixi 7`; its backend is WebGL. Omit options in an interactive terminal to
answer prompts.

The generated project uses Node.js watch mode for source reloads, `tsc` for the
production build, and Prettier for formatting. The generator writes the files
and prints the next commands without installing dependencies.

## PixiJS 8 quick start

```ts
import {
  Assets,
  Sprite,
  createApp,
  createModuleFileAccess,
} from "@matjash/pixi-native";

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
import { Graphics, createApp } from "@matjash/pixi-native/pixi7";

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
- [Pixi Native API reference](docs/api-reference.md)
- [Media and files](docs/media-and-files.md)
- [GSAP integration](docs/integrations/gsap.md)
- [Deployment and release archives](docs/deployment.md)

Package tarballs include these guides and the public TypeScript declarations.

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

Development runs with V8 garbage collection exposed. A startup sample and a
sample every 150 seconds are appended as JSONL to `logs/memoryInfo.log`; on
startup an existing log is rotated to `logs/memoryInfo-prev.log`. Press
`Delete` to run a manual GC and print before/after memory and scene-object
counts. Sprite+GSAP samples also include GSAP tween/timeline totals and the
Pixi asset-cache size, so native RSS growth can be separated from retained JS
objects. A scene-entry sample is written after each scene change; if the scene
stays unchanged, another sample is written every 150 seconds. Automatic scene
cycling is enabled by default and advances every 15 seconds through non-media
scenes; press `Space` to toggle it on or off. Set `AUTOTOGGLE_INTERVAL` in
`.env` to change the interval (in seconds). The state is printed to the
console and written to the log.
WebGL samples also include created, deleted, live, and peak counts for buffers,
textures, framebuffers, renderbuffers, programs, shaders, and vertex arrays.
`webglBufferBytesLive` and `webglBufferBytesPeak` track storage assigned with
`bufferData`, allowing RSS growth to be compared with JavaScript-visible GL
object lifetimes and buffer reallocations. The same counters are emitted by
the PixiJS 8 and PixiJS 7 WebGL demos.
Run `pnpm analyze-memory-info` for a compact summary of the log, including
memory deltas, scene counts, timestamp/sequence gaps, and a late RSS trend
classification. The analyzer distinguishes a stable plateau from slow growth,
clear growth, decline, instability, and insufficient data by comparing
five-minute medians of `scene-exit:after` baselines. To analyze a log outside
the repository, pass its path explicitly, for example:

```powershell
pnpm analyze-memory-info --path "D:\temp\logs-pixi-native\logs\memoryInfo-webgl-20260915T080603623Z-p11408-r0.log"
```

The existing positional form, `pnpm analyze-memory-info "<path>"`, remains
supported. Add `--html` to also write an interactive
`<log-name>.report.html` beside the input log:

```powershell
pnpm analyze-memory-info --path "D:\temp\logs-pixi-native\logs\memoryInfo-webgl-20260915T080603623Z-p11408-r0.log" --html
```

HTML reports keep their summary and tables offline, but their charts require
internet access because Chart.js 4.5.1 is loaded from jsDelivr. No charting
dependency is installed or bundled with the portable demo.
Run `pnpm isolate-native-memory -- --duration-seconds 600 --backend=all --parallel`
to launch visible PixiJS 8 WebGL/WebGPU and PixiJS 7 WebGL RSS runs together;
each result is written to `logs/native-memory-isolation/<backend>.log` for
comparison. Omit `--parallel` to run the selected backends sequentially.
Pass `--scenes=graphics,video` to cycle only named scenes; isolated scene runs
are kept in their own `logs/native-memory-isolation/<scene-pair>/` directory.
RTP remains manual-only in this automatic mode to avoid reconnect attempts when
the stream is unavailable. Local video and transparent-video variants are part
of automatic cycling; their manual controls are unchanged.
RTP streams are explicitly destroyed when leaving their scene so reconnect
workers cannot outlive the scene.

For focused WebGL resource diagnostics, run these sequentially:

```powershell
pnpm isolate-native-memory -- --duration-seconds 1800 --backend=webgl --scenes=graphics,text --unique-output
pnpm isolate-native-memory -- --duration-seconds 1800 --backend=webgl --scenes=particles,text --unique-output
pnpm isolate-native-memory -- --duration-seconds 1800 --backend=webgl --scenes=sprite-gsap,text --unique-output
```

At least two scenes are required because selecting the already-active scene is
intentionally a no-op. Repeat the pair that grows with `--backend=webgl7` to
compare PixiJS 7 against the same native WebGL implementation.

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
[SDL](https://www.libsdl.org/), [webgl-node](https://github.com/monteslu/webgl-node),
and [native-gles](https://github.com/monteslu/native-gles). The Node.js
integration also uses
[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas),
[napi-rs](https://napi.rs/), [miniaudio](https://miniaud.io/), and
[FFmpeg](https://ffmpeg.org/).

Thanks to the maintainers and contributors of those projects. Their work makes
the native renderer, window, canvas, audio, and media layers possible. See
[Third-party notices](THIRD_PARTY_NOTICES.md) for license and redistribution
details.

## License

Pixi Native uses the [MIT License](LICENSE). Third-party components retain
their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
