# PixiJS 8 + Node Native WebGPU

Minimal proof of concept for rendering PixiJS 8 directly into a native SDL window from Node.js, without a browser DOM, WebView, CEF, or WebGL fallback.

## Stack

- Node.js 22+
- pnpm 9.15.9
- PixiJS 8.20.0
- Dawn WebGPU through the project-owned native Node addon
- SDL native window and swap chain through `@kmamal/sdl`
- Skia-backed `NodeCanvas` using `@napi-rs/canvas` for Canvas2D text and image rasterization
- Rust/napi-rs video bridge for native FFmpeg stdout frame delivery
- CMake, a C++ compiler, and Go 1.26+ for rebuilding the addon

The project-owned native addon creates the Dawn adapter/device and connects it to the native SDL window. Pixi receives the same adapter and device through `gpu: { adapter, device }`. Pixi is initialized with `preference: ["webgpu"]`, so initialization fails instead of falling back to WebGL.

## Run on Ubuntu 24

```sh
pnpm install
pnpm native:build
pnpm dev
```

The first native build downloads a pinned Dawn source tree and creates the Linux x64 addon in `native/gpu/dist/linux-x64/`. On Ubuntu, install the native build prerequisites with `sudo apt install cmake g++ libx11-xcb-dev`; Go must be 1.26 or newer. Vulkan is selected by default and can be overridden with `WGPU_BACKEND`.

## Run on Windows 11 x64

Install these prerequisites first:

- Visual Studio 2022 v17.11 or newer with **Desktop development with C++**
- MSVC v143 and Windows 11 SDK 10.0.26100.0 or newer
- CMake and Git in `PATH`
- Go 1.26 or newer in `PATH`

Open **Developer PowerShell for VS 2022**, then run:

```powershell
cd D:\projects\2026\node-pixi8-wgpu
pnpm install
pnpm typecheck
pnpm test
pnpm native:build
pnpm dev
```

The preflight runs before any generated native directories are removed and reports every missing prerequisite together. The first build downloads the pinned Dawn and depot_tools sources and can take a while. Windows source downloads use Git's OpenSSL backend only inside the build subprocesses. The initial CIPD client uses Node TLS and is verified against depot_tools' pinned SHA-256 digest. Both paths preserve TLS verification while avoiding Windows `schannel` credential-context failures. The build creates `native/gpu/dist/win32-x64/dawn.node` and copies the matching Windows SDK `d3dcompiler_47.dll` beside it; both are local output and ignored by Git. D3D12 is selected by default; `WGPU_BACKEND` remains available as an explicit override.

## Demo

The demo cycles through Graphics, Sprite, and normal Pixi Text on every supported platform. It shows a continuously updated FPS overlay in the upper-right corner and logs renderer, backend, adapter, and presentation format. The Sprite uses `assets/test-texture.png`; image and normal Text rasterization use the native Skia-backed `NodeCanvas` adapter.

On Linux, the demo also includes an FFmpeg VA-API video scene. It requires a system FFmpeg with VA-API support and an H.264 VA-API decode device. Set `FFMPEG_PATH` to override the executable and `FFMPEG_VAAPI_DEVICE` to override the default `/dev/dri/renderD128` device. The 4K High 4:2:2 samples in `assets` are not supported by the UHD 620 VA-API decoder; the bridge automatically falls back to the CPU decoder for those files and shows the active backend in the video status.

Build the video bridge once before running the demo:

```sh
pnpm native:video:build
```

The bridge starts FFmpeg from Rust, reads complete RGBA frames into native-owned buffers, and exposes each buffer to Node without an additional JS copy. The FFmpeg process pipe and WebGPU staging upload remain, so this is not end-to-end zero-copy. On the video scene, use Up/Down to cycle through all MP4 files in `assets`.

On Linux, scenes are selected with `1`–`4`. On Windows, scenes `1`–`3` are available and `4` is ignored. Use the left and right arrow keys to move between available scenes. Key-repeat events are ignored.

## Current limitations

The checked-in prebuilt addon targets Linux x64 and Vulkan. Windows x64 builds its own ignored D3D12 addon from the pinned source. The native video bridge remains Linux-only. The native window, renderer, ticker, Sprite, Graphics, and Text paths are isolated from the desktop host runtime; there is no WebView or WebGL fallback.
