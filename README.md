# PixiJS 8 + Node Native WebGPU

Minimal proof of concept for rendering PixiJS 8 directly into a native SDL window from Node.js, without a browser DOM, WebView, or CEF. WebGPU is the default; WebGL is available with `PIXI_RENDERER=webgl`.

## Stack

- Node.js 24 LTS
- pnpm 9.15.9
- PixiJS 8.20.0
- Dawn WebGPU through the project-owned native Node addon
- SDL native window and swap chain through `@kmamal/sdl`
- Optional WebGL2 window rendering through `@node-3d/glfw` and `@node-3d/webgl`
- Skia-backed `NodeCanvas` using `@napi-rs/canvas` for Canvas2D text and image rasterization
- Rust/napi-rs video bridge for native FFmpeg stdout frame delivery
- CMake, a C++ compiler, and Go 1.26+ for rebuilding the addon

The WebGL backend is optional and uses prebuilt, ABI-compatible native packages; it does not require Python or a local node-gyp build. The default WebGPU backend does not load these packages.

The project-owned native addon creates the Dawn adapter/device and connects it to the native SDL window. Pixi receives the same adapter and device through `gpu: { adapter, device }` in WebGPU mode. Set `PIXI_RENDERER=webgl` to use a GLFW OpenGL context with the WebGL2 API from `@node-3d/webgl`; there is no automatic backend fallback.

Set `PIXI_RENDERER=webgpu` or `PIXI_RENDERER=webgl` in the local `.env`; `.env.example` contains the default. WebGPU owns the SDL window and WebGL owns a GLFW window, so the two native window paths remain independent.

## Requirements

The supported development targets are Linux x64 and Windows 11 x64. The same Node.js and pnpm versions should be used on both platforms:

- Node.js 24 LTS
- pnpm 9.15.9
- Git
- CMake
- Go 1.26 or newer (required by Dawn's native build generators)
- Rust and Cargo (required by the native video bridge)
- FFmpeg available as `ffmpeg` and, preferably, `ffprobe` when using video or audio scenes

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

The preflight runs before any generated native directories are removed and reports every missing prerequisite together. The first build downloads the pinned Dawn and depot_tools sources and can take a while. Windows source downloads use Git's OpenSSL backend only inside the build subprocesses. The initial CIPD client uses Node TLS and is verified against depot_tools' pinned SHA-256 digest. Both paths preserve TLS verification while avoiding Windows `schannel` credential-context failures. The build creates `native/gpu/dist/win32-x64/dawn.node` and copies the matching Windows SDK `d3dcompiler_47.dll` beside it; both are local output and ignored by Git. D3D12 is selected by default; `WGPU_BACKEND` remains available as an explicit override.

## Demo

The demo cycles through Graphics, Sprite, normal Pixi Text, BitmapText, native video, and native audio on Windows x64 and Linux x64. It shows FPS, average frame time, and frame-time jitter in the upper-right corner and logs renderer, backend, adapter, display refresh rate, and presentation format. On Windows/D3D12, RAF is paced by DXGI's frame-latency waitable-object signal with a maximum frame latency of one; during Windows modal move/resize loops, a native window callback continues driving the Pixi ticker so GSAP and video clocks keep advancing. Other platforms and unavailable signals use a deadline timer matched to SDL's current display refresh rate. FIFO presentation remains enabled. The Sprite test uses `assets/test-texture.png` plus generated transparent bat and platform-mascot textures, with GSAP timelines driven by the same RAF scheduler. Image and normal Text rasterization use the native Skia-backed `NodeCanvas` adapter.

The BitmapText scene covers both supported font paths: a runtime atlas generated by `BitmapFont.install()` and an external plain-text BMFont descriptor plus PNG atlas loaded through `Assets`. The external test font is a deterministic, license-free procedural 5x7 design. Regenerate its checked-in files with:

```sh
pnpm assets:bitmap-font
```

The Node DOM adapter reads absolute filesystem paths and `file:` URLs directly, so the `.fnt` descriptor can resolve its sibling PNG without an HTTP server. XML BMFont descriptors are not supported by this PoC.

Frequently updated FPS, frame-time, jitter, and video decoder statistics use the shared runtime BitmapFont atlas. Updating these labels rebuilds only BitmapText geometry and does not rerasterize Canvas text or upload a new text texture.

The video scene uses FFmpeg D3D11VA on Windows and VA-API on Linux, with an automatic CPU fallback when the hardware decoder cannot handle a source. Set `FFMPEG_VAAPI_DEVICE` to override the default Linux device `/dev/dri/renderD128`. The 4K High 4:2:2 samples in `assets` may use the fallback on hardware that supports only 4:2:0 decode.

Build the video bridge once before running the demo:

```sh
pnpm native:video:build
```

The bridge starts FFmpeg from Rust and requests packed 8-bit NV12 normalized to BT.709 limited range. Each native-owned frame becomes one external N-API buffer; Y and interleaved UV are zero-copy views uploaded to `r8unorm` and `rg8unorm` textures. A WebGPU-only Pixi `Mesh` shader converts NV12 to RGB. At 1280×720 this transfers 1,382,400 bytes per frame instead of 3,686,400 RGBA bytes. The process pipe and WebGPU staging upload remain, so this is not decoder-to-GPU zero-copy.

FFmpeg executable lookup uses this order:

1. `NativeVideoOptions.ffmpegPath`;
2. `FFMPEG_PATH`;
3. `native/video/dist/<platform>-<arch>/ffmpeg[.exe]` next to the packaged addon;
4. `ffmpeg` from `PATH` for development.

Production packaging may place a verified FFmpeg executable in the app-relative location above. The binary is intentionally not downloaded or committed by this repository; the distributor must include the license and comply with the selected FFmpeg build's LGPL/GPL configuration.

`NativeVideo` provides `load()`, `play()`, `pause()`, writable `src` and `currentTime`, metadata, `loop`, `playbackRate`, volume/mute controls, EventTarget-compatible media events, separate video/audio error state, and decode/presentation/drop statistics. File metadata is probed with `ffprobe` beside the selected FFmpeg executable when available. Embedded audio is decoded as a bounded FFmpeg PCM stream and acts as the master playback clock; video-only files continue without audio. During the Windows move/resize modal loop file video continues silently, then discards stale audio and restarts A/V at the latest presented video time. On the video scene, use Up/Down to cycle through all MP4 files in `assets`.

Callers may pass structured `ffmpeg.inputArgs`, `videoOutputArgs`, and `audioOutputArgs`. The module inserts input arguments before its owned `-i`, then appends its mandatory NV12 or PCM pipe output. `mediaType: "live"` and `inputPacing: "source"` disable file-style `-readrate`; bounded latest-frame delivery supplies ffplay-like frame dropping without accepting ffplay-only `-framedrop` or `-sync` flags. Authenticated URL credentials are redacted from surfaced FFmpeg errors.

Scene `7` runs two simultaneous low-latency HTTP/SDP/RTP camera streams. Copy the RTP variables from `.env.example` into the ignored local `.env`; authenticated URLs must never be committed. The scene adds protocol whitelist, local-address, no-buffer, low-delay, probe-size, analyze-duration, and single-thread input options, with `RTP_TEST_EXTRA_INPUT_ARGS_JSON` available for additional trusted FFmpeg arguments. It automatically reconnects each stream with bounded exponential backoff.

The native audio module exports Howler-style `Howl` and `Howler` objects for shared application code. It supports overlapping voices, audio sprites, per-sound and global volume/mute, pause/stop/seek, looping, fades, events, preload, and unload. Short effects and music sprites are cached as decoded stereo 48 kHz PCM; `html5: true` and video audio use a bounded streaming path. Repeated fades on one voice are latest-wins: a replacement continues from the current mixer volume and stale completion events are suppressed, including across a looping sprite boundary.

Scene `6` exercises two sound sprites, looping music, and a generated MP3 drum atlas. Its transparent drum-kit texture has normalized hit regions ready for later pointer input. Regenerate the deterministic WAV music fixture, synthesized drum MP3, and atlas descriptor with `pnpm assets:audio-test`.

Demo scene transitions use strict ownership rather than caching: the outgoing scene recursively destroys its Pixi renderables, Text GPU data, and owned Graphics contexts. Video scenes additionally close FFmpeg and release both NV12 texture planes, shader bind groups, geometry, and vertex/index buffers. Shared application textures are retained until application shutdown.

Scenes are selected with `1`–`8`: Graphics, Sprite, Text, BitmapText, Video, Audio, dual RTP Video, and Rain Sprite. Use the left and right arrow keys to move between scenes. In the Sprite scene, Up adds ten randomly placed and animated sprites and Down removes the latest ten; in the Rain Sprite scene, Up adds two falling `AnimatedSprite` drops and Down removes two, M toggles rain sound, and each drop plays a sound when it reaches the bottom while unmuted. In the Video scene, Up and Down continue to select the video. In the Audio scene, A/S play overlapping sprites, M starts or repeats the looping-music fade-in, F fades it out, and Space toggles global mute. The drum mapping is U crash, I closed hi-hat, O ride, P high tom, J snare, K kick, L floor tom, and Č open hi-hat. Key-repeat events are ignored.

## Current limitations

The checked-in GPU addon targets Linux x64 and Vulkan. Windows x64 builds its own ignored D3D12 addon from the pinned source. Native video currently supports Windows x64 and Linux x64 and requires the WebGPU backend. Video output is normalized SDR BT.709 limited NV12; source color metadata, HDR, direct D3D11/VA-API surface import, Howler spatial audio, and native compressed-audio decoding are not implemented. Audio decoding and pitch-preserving video rate changes currently require FFmpeg. Live video is non-seekable, has infinite duration, and intentionally supports only playback rate 1. The native window, renderer, ticker, Sprite, Graphics, Text, BitmapText, video, and audio paths are isolated from the desktop host runtime; there is no WebView fallback.
