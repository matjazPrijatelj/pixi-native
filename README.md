# Pixi Native

Native PixiJS runtime for rendering directly into a native window from Node.js, without a browser DOM, WebView, or CEF. The package exposes explicit `pixi-native/v7` and `pixi-native/v8` entrypoints so each display process selects one Pixi major.

## Stack

- Node.js 24.13 or newer from the Node.js 24 LTS line
- pnpm 9.15.9
- PixiJS 8.20.0
- PixiJS 7.4.3 WebGL through `pixi-native/v7`
- Dawn WebGPU through the project-owned native Node addon
- SDL native window and swap chain through `@kmamal/sdl`
- Windows WebGL2 through SDL plus `webgl-node`/`native-gles` ANGLE/EGL
- Linux WebGL2 through `@node-3d/core` and `@node-3d/glfw`
- Skia-backed `NodeCanvas` using `@napi-rs/canvas` for Canvas2D text and image rasterization
- Rust/napi-rs video bridge for native FFmpeg stdout frame delivery
- CMake, a C++ compiler, and Go 1.26+ for rebuilding the addon

The WebGL backend uses prebuilt, ABI-compatible native packages and does not require Python or a local node-gyp build. The default WebGPU backend does not load them.

The project-owned native addon creates the Dawn adapter/device and connects it to the native SDL window. Pixi receives the same adapter and device through `gpu: { adapter, device }` in WebGPU mode. On Windows the WebGL entrypoints attach an ANGLE/EGL WebGL2 context to an SDL `HWND`; Linux retains the GLFW backend. There is no automatic backend fallback.

The demo selects its renderer explicitly: use `pnpm dev:webgpu`, `pnpm dev:webgl`, or `pnpm dev:webgl7`. The commands open the interactive scene demo; use number keys or left/right to switch between Graphics, Sprite, Text, BitmapText, audio, video, rain-sprite, and particle scenes. WebGPU and Windows WebGL share SDL window behavior while owning separate Dawn and ANGLE presentation surfaces.

For Pixi 8 library use, install the package and Pixi peer dependency with `pnpm add pixi-native pixi.js@8.20.0`. Pixi 7 is an internal package dependency. The versioned entrypoint exports both the matching Pixi API and the managed native factories:

```ts
import { Sprite, createApp } from "pixi-native/v8";

const { app, native, destroy } = await createApp({
  backend: "webgpu", // or "webgl"
  width: 1280,
  height: 720,
  borderless: false,
  transparent: true,
  backgroundAlpha: 0.5,
  x: 0,
  y: 0,
});

app.stage.addChild(Sprite.from("./character.png"));

native.window.setPosition(2000, 100);
native.window.minimize();
native.window.maximize();
native.window.restore();

// Optional explicit teardown. Window close, SIGINT, and SIGTERM use the same path.
await destroy();
```

The returned `app` is the normal Pixi `Application`; scene code can use Pixi
containers, sprites, graphics, text, ticker callbacks, and interaction APIs
without a separate native render loop. `addDestroyListener()` registers cleanup
for application-owned native resources. The initializer intentionally provides
only the browser surface Pixi needs: it does not emulate HTML/CSS layout,
browser media elements, navigation, or arbitrary DOM applications.

Use `createRenderer()` from the same versioned entrypoint when the caller needs
to own polling, rendering, presentation, and teardown. Pixi 8 accepts
`backend: "webgpu" | "webgl"`; Pixi 7 is WebGL-only. The package declares
PixiJS 8 as a peer dependency so applications can update it within the
supported major version.

Display code can resolve and read its own packaged files without depending on
the launcher's working directory through the lightweight `pixi-native/files`
entrypoint:

```ts
import { createModuleFileAccess } from "pixi-native/files";

const files = createModuleFileAccess(import.meta.url);
const config = await files.readJson("../assets/config.json");
const texturePath = files.resolvePath("../assets/character.png");
```

Relative sources are resolved beside the calling module. Absolute paths, UNC
paths, and `file:` URLs remain absolute and may point outside the display or
release directory, including to another Windows drive. The helper only reads
the filesystem; HTTP requests still use `fetch`, and callers use `node:fs`
directly when they need to write files.

The WebGPU, WebGL, and PixiJS 7 WebGL factories accept the same native-window
options and expose the same programmatic window controls. The optional `x` and
`y` values are absolute integer coordinates in the virtual desktop, must be
provided together, and may be negative for monitors left of or above the
primary display. A borderless window defaults to non-resizable;
`borderless: true` together with `resizable: true` is rejected. This API does
not add a custom title bar, drag region, or resize handles. `maximize()` uses
the operating system work area and does not enable fullscreen or always-on-top
behavior.

Per-pixel transparency is currently supported on Windows 11. With
`transparent: true`, transparent Pixi pixels reveal the desktop and
partially-transparent pixels retain smooth premultiplied-alpha edges. The
optional `backgroundAlpha` controls the Pixi background opacity from `0` to
`1`; it defaults to `0` for transparent windows and `1` otherwise. When
`transparent` is false, a lower value emits a warning and is normalized to
`1`. All renderers use premultiplied presentation, so `0.5` contributes half
of the background color consistently on a transparent window. The
transparent areas still receive mouse input; click-through and runtime
transparency switching are not part of this API. Other platforms reject the
option instead of silently creating an opaque window.

All renderers use 4x MSAA by default. Set `antialiasSamples` to `0`, `2`, `4`,
or `8` to trade edge quality for GPU cost; `0` disables antialiasing. Windows
WebGL falls back to the highest supported lower value, while GLFW WebGL reports
the sample count provided by the platform. PixiJS WebGPU supports only 0x or 4x,
so explicit 2x and 8x requests use 4x with a warning.

PixiJS 7 is available through `pixi-native/v7`; application code never imports
the internal `pixi.js-v7` alias. Run the isolated scene demo with
`pnpm dev:webgl7`; it contains the same nine scene slots as the Pixi 8 demo,
with Pixi 7-specific Graphics, text, sprite, particle, and native media
adaptations. Use number keys `1`–`9` or left/right to navigate.
Both versioned entrypoints expose the compact `createApp()`, `createRenderer()`,
`App`, `AppOptions`, `RendererResult`, `RendererOptions`, and `VideoSprite`
names. Low-level Node/native implementation types are not part of these
facades.

`VideoSprite` accepts an optional packed-alpha layout for videos that store the
color image on the left and a grayscale alpha mask on the right. The mask scale
is its width divided by the color width; a 1920x768 frame containing 1280x768
color plus a 640x768 mask uses:

```ts
const sprite = new VideoSprite(video, { alphaMaskScale: 0.5 });
```

The split must produce positive, even pixel widths so both NV12 chroma regions
remain aligned. Omitting the option retains normal opaque video rendering.

## Requirements

The supported development targets are Linux x64 and Windows 11 x64. The same Node.js and pnpm versions should be used on both platforms:

- Node.js 24.13 or newer from the Node.js 24 LTS line
- pnpm 9.15.9
- Git
- CMake
- Go 1.26 or newer (required by Dawn's native build generators)
- Rust and Cargo (required by the native video bridge)
- FFmpeg available as `ffmpeg` and, preferably, `ffprobe` for development video or audio scenes

## Distribution package

Create the verified private package with:

```sh
pnpm pack:dist
```

On Windows x64, first build the pinned minimal FFmpeg runtime with:

```powershell
pnpm ffmpeg:build
```

The command requires a healthy MSYS2 UCRT64 installation with `base-devel`,
`nasm`, and `mingw-w64-ucrt-x86_64-toolchain`. Its preflight reports missing
tools but never installs system prerequisites. It builds pinned FFmpeg 8.0 as
two static LGPL executables, stages `ffmpeg.exe`, `ffprobe.exe`, the LGPL text
and build manifest, and records SHA-256 checksums. The executables are tracked
through Git LFS. `pnpm ffmpeg:stage` can restage an already completed build.
Install or repair MSYS2 separately, open its UCRT64 shell, update it as directed
by MSYS2, then install the required packages with:

```sh
pacman -S --needed base-devel nasm mingw-w64-ucrt-x86_64-toolchain
```

The build expects `C:\msys64` by default; set `MSYS2_ROOT` when MSYS2 is
installed elsewhere.

The command runs type checking, the complete Node test suite, a production
TypeScript build, native-artifact validation, and `npm pack`. It writes
`artifacts/pixi-native-0.1.0.tgz`, the corresponding pinned FFmpeg source
archive, and SHA-256 files for both. It does not rebuild the native addons or
FFmpeg.

Install the tarball together with the PixiJS 8 peer dependency:

```sh
pnpm add ./artifacts/pixi-native-0.1.0.tgz pixi.js@8.20.0
```

The x64 package currently contains the Windows GPU binding, Windows and Linux
video bindings, and the Windows modal-window and native-audio bindings. Linux
WebGPU reports an explicit unsupported-platform error until its new
`pixi_native_gpu.node` addon is built and added to the distribution. Linux
WebGL remains available. The package owns its internal PixiJS 7 alias for the
`pixi-native/v7` entrypoint. Windows includes the staged
minimal LGPL FFmpeg and FFprobe runtime. Linux FFmpeg is not bundled yet; set
`FFMPEG_PATH` or make `ffmpeg` and `ffprobe` available in `PATH` there.

The repository contains the TypeScript source and project patches, but native build output is platform-specific. Build the GPU addon on the platform where it will run; Linux and Windows artifacts must not be shared.

## Run on Ubuntu 24

Before building on Ubuntu/Debian, install the native packages:

```sh
sudo apt update
sudo apt install build-essential cmake curl git libx11-xcb-dev pkg-config ffmpeg
```

Install Rust and Cargo using the official `rustup` installer if they are not already available. Install Go 1.26 or newer and make sure the selected binary is first in `PATH`:

```sh
go version
cargo --version
```

Then build and run:

```sh
pnpm install
pnpm native:build
pnpm native:video:build
pnpm typecheck
pnpm test
pnpm dev
```

The first GPU build downloads a pinned Dawn source tree and creates the Linux x64 addon in `native/gpu/dist/linux-x64/`. Vulkan is selected by default and can be overridden with `WGPU_BACKEND`.

If `go version` still reports an older system Go after installing a newer release, fix the current shell before running the build, for example:

```sh
export PATH="$HOME/.local/opt/go1.26.5/bin:$PATH"
export GOTOOLCHAIN=local
hash -r
go version
```

Use the actual installation directory on your machine. These exports affect only the current shell; add the `PATH` line to your shell profile if it should persist.

## Run on Windows 11 x64

Install these prerequisites first:

- Visual Studio 2022 v17.11 or newer with **Desktop development with C++**
- MSVC v143 and Windows 11 SDK 10.0.26100.0 or newer
- CMake and Git in `PATH`
- Go 1.26 or newer in `PATH`
- Rust and Cargo in `PATH` (required for the video bridge)
- FFmpeg in `PATH` (required for the video/audio scenes); `ffprobe` is recommended for metadata probing
- MSYS2 UCRT64 with `base-devel`, `nasm`, and the UCRT64 GCC toolchain when rebuilding the packaged minimal FFmpeg

Open **Developer PowerShell for VS 2022**, then run:

```powershell
cd D:\projects\2026\node-pixi8-wgpu
pnpm install
pnpm typecheck
pnpm test
pnpm native:build
pnpm native:video:build
pnpm dev
```

The preflight runs before any generated native directories are removed and reports every missing prerequisite together. The first build downloads the pinned Dawn and depot_tools sources and can take a while. Windows source downloads use Git's OpenSSL backend only inside the build subprocesses. The initial CIPD client uses Node TLS and is verified against depot_tools' pinned SHA-256 digest. Both paths preserve TLS verification while avoiding Windows `schannel` credential-context failures. The build creates the project-owned `native/gpu/dist/win32-x64/pixi_native_gpu.node` addon and copies the matching Windows SDK `d3dcompiler_47.dll` beside it; both are local output and ignored by Git. The addon links Dawn's public native and Node interop targets and owns instance, device, and surface creation, so Dawn's Node module does not need private-access or presentation patches. D3D12 is selected by default; `WGPU_BACKEND` remains available as an explicit override.

## Demo

The demo cycles through Graphics, Sprite, normal Pixi Text, BitmapText, native video, and native audio on Windows x64 and Linux x64. It shows FPS, average frame time, and frame-time jitter in the upper-right corner and logs renderer, backend, adapter, display refresh rate, and presentation format. With the default `vsync: true`, Windows/D3D12 uses FIFO presentation and RAF is paced by the Windows compositor clock; unavailable compositor signals fall back to a deadline timer matched to SDL's current display refresh rate. During Windows modal move/resize loops, a native window callback continues driving the Pixi ticker so GSAP and video clocks keep advancing. Setting `vsync: false` selects immediate WebGPU presentation and timer-paced RAF; optional `maxFps` can raise or lower that timer rate from its display-refresh default within 24–360 FPS. `maxFps` is ignored with a warning while VSync is enabled. The Sprite test uses `src/demo/assets/test-texture.png` plus generated transparent bat and platform-mascot textures, with GSAP timelines driven by the same RAF scheduler. Image and normal Text rasterization use the native Skia-backed `NodeCanvas` adapter.

The BitmapText scene covers both supported font paths: a runtime atlas generated by `BitmapFont.install()` and an external plain-text BMFont descriptor plus PNG atlas loaded through `Assets`. The external test font is a deterministic, license-free procedural 5x7 design. Regenerate its checked-in files with:

```sh
pnpm assets:bitmap-font
```

The Node DOM adapter reads absolute filesystem paths and `file:` URLs directly, so the `.fnt` descriptor can resolve its sibling PNG without an HTTP server. XML BMFont descriptors are not supported by this PoC.

Frequently updated FPS, frame-time, jitter, and video decoder statistics use the shared runtime BitmapFont atlas. Updating these labels rebuilds only BitmapText geometry and does not rerasterize Canvas text or upload a new text texture.

The video scene uses FFmpeg D3D11VA on Windows and VA-API on Linux, with an automatic CPU fallback when the hardware decoder cannot handle a source. Set `FFMPEG_VAAPI_DEVICE` to override the default Linux device `/dev/dri/renderD128`. The 4K High 4:2:2 samples in `src/demo/assets` may use the fallback on hardware that supports only 4:2:0 decode.

Build the video bridge once before running the demo:

```sh
pnpm native:video:build
```

The bridge starts FFmpeg from Rust and requests packed 8-bit NV12 normalized to BT.709 limited range. Each native-owned frame becomes one external N-API buffer; Y and interleaved UV are zero-copy views uploaded to `r8unorm` and `rg8unorm` textures. Pixi WebGPU and WebGL2 shaders convert NV12 to RGB. At 1280×720 this transfers 1,382,400 bytes per frame instead of 3,686,400 RGBA bytes. The process pipe and GPU upload remain, so this is not decoder-to-GPU zero-copy.

FFmpeg executable lookup uses this order:

1. `NativeVideoOptions.ffmpegPath`;
2. `FFMPEG_PATH`;
3. `native/video/dist/<platform>-<arch>/ffmpeg[.exe]` next to the packaged addon;
4. `ffmpeg` from `PATH` for development.

The Windows distribution places the verified static LGPL FFmpeg 8.0 runtime
in that app-relative location, including FFprobe, license, build manifest, and
checksums. It contains only H.264/H.265, common MP4/RTP inputs, AAC/MP3/PCM
audio, the filters used by this runtime, D3D11VA, and the raw NV12/f32le output
paths. Linux continues to use `FFMPEG_PATH` or `PATH` until a Linux bundle is
added. See `THIRD_PARTY_NOTICES.md` for the exact source commit.

`NativeVideo` provides `load()`, `play()`, `pause()`, writable `src` and `currentTime`, metadata, `loop`, `playbackRate`, volume/mute controls, EventTarget-compatible media events, separate video/audio error state, and decode/presentation/drop statistics. Assigning `src` reloads the source immediately and preserves active playback; an existing Pixi 7 or Pixi 8 `VideoSprite` clears its old frame and consumes the replacement decoder without being recreated. File metadata is probed with `ffprobe` beside the selected FFmpeg executable when available. Embedded audio is decoded as a bounded FFmpeg PCM stream and acts as the master playback clock; video-only files continue without audio. During the Windows move/resize modal loop file video continues silently, then discards stale audio and restarts A/V at the latest presented video time. On the video scene, use Up/Down to cycle through all MP4 files in `src/demo/assets`. Press E for the source-event mode, where Up/Down assigns `src` on one active video, A toggles five-second automatic source changes, and every media event is shown in the scene and logged to the console. Press T to play the packed-alpha fixture over a checkerboard background.

Callers may pass structured `ffmpeg.inputArgs`, `videoOutputArgs`, and `audioOutputArgs`. The module inserts input arguments before its owned `-i`, then appends its mandatory NV12 or PCM pipe output. `mediaType: "live"` and `inputPacing: "source"` disable file-style `-readrate`; bounded latest-frame delivery supplies ffplay-like frame dropping without accepting ffplay-only `-framedrop` or `-sync` flags. Authenticated URL credentials are redacted from surfaced FFmpeg errors.

Scene `7` runs two simultaneous low-latency HTTP/SDP/RTP camera streams. Copy the RTP variables from `.env.example` into the ignored local `.env`; authenticated URLs must never be committed. The scene adds protocol whitelist, local-address, no-buffer, low-delay, probe-size, analyze-duration, and single-thread input options, with `RTP_TEST_EXTRA_INPUT_ARGS_JSON` available for additional trusted FFmpeg arguments. It automatically reconnects each stream with bounded exponential backoff.

The native audio module exports Howler-style `Howl` and `Howler` objects for shared application code. It supports overlapping voices, audio sprites, per-sound and global volume/mute, pause/stop/seek, looping, fades, events, preload, and unload. Short effects and music sprites are cached as decoded stereo 48 kHz PCM; `html5: true` and video audio use a bounded streaming path. Repeated fades on one voice are latest-wins: a replacement continues from the current mixer volume and stale completion events are suppressed, including across a looping sprite boundary.

Scene `6` exercises two sound sprites, looping music, and a generated MP3 drum atlas. Its transparent drum-kit texture has normalized hit regions ready for later pointer input. Regenerate the deterministic WAV music fixture, synthesized drum MP3, and atlas descriptor with `pnpm assets:audio-test`.

Demo scene transitions use strict ownership rather than caching: the outgoing scene recursively destroys its Pixi renderables, Text GPU data, and owned Graphics contexts. Video scenes additionally close FFmpeg and release both NV12 texture planes, shader bind groups, geometry, and vertex/index buffers. Shared application textures are retained until application shutdown.

Scenes are selected with `1`–`9`: Graphics, Sprite, Text, BitmapText, Video, Audio, dual RTP Video, Rain Sprite, and Particle. Use the left and right arrow keys to move between scenes. In the Sprite scene, Up adds ten randomly placed and animated sprites and Down removes the latest ten; in the Rain Sprite scene, Up adds two falling `AnimatedSprite` drops and Down removes two, M toggles rain sound, and each drop plays a sound when it reaches the bottom while unmuted. In the Video scene, Up and Down select the video, M toggles the mask, E toggles the source-event mode, and T toggles the packed-alpha fixture. In the Audio scene, A/S play overlapping sprites, M starts or repeats the looping-music fade-in, F fades it out, and Space toggles global mute. The drum mapping is U crash, I closed hi-hat, O ride, P high tom, J snare, K kick, L floor tom, and Č open hi-hat. Key-repeat events are ignored.

## Current limitations

The distributed GPU addon currently targets Windows x64 and D3D12. Linux x64 WebGPU is temporarily unsupported until the project-owned Vulkan addon is built; the legacy checked-in `dawn.node` is not packaged because it does not implement the new native context API. Native video currently supports Windows x64 and Linux x64, including the WebGL2 path on Linux. Video output is normalized SDR BT.709 limited NV12; source color metadata, HDR, direct D3D11/VA-API surface import, Howler spatial audio, and native compressed-audio decoding are not implemented. Audio decoding and pitch-preserving video rate changes currently require FFmpeg. Live video is non-seekable, has infinite duration, and intentionally supports only playback rate 1. The native window, renderer, ticker, Sprite, Graphics, Text, BitmapText, video, and audio paths are isolated from the desktop host runtime; there is no WebView fallback.
