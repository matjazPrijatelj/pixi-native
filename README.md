# PixiJS 8 + Node Native WebGPU

Minimal proof of concept for rendering PixiJS 8 directly into a native SDL window from Node.js, without a browser DOM, WebView, CEF, or WebGL fallback.

## Stack

- Node.js 22+
- pnpm 9.15.9
- PixiJS 8.20.0
- Dawn WebGPU through the project-owned native Node addon
- SDL native window and swap chain through `@kmamal/sdl`
- Skia Canvas2D only for normal Pixi `Text` rasterization
- CMake, a C++ compiler, Go 1.26+, and `libx11-xcb-dev` for rebuilding the addon

The project-owned native addon creates the Dawn adapter/device and connects it to the native SDL window. Pixi receives the same adapter and device through `gpu: { adapter, device }`. Pixi is initialized with `preference: ["webgpu"]`, so initialization fails instead of falling back to WebGL.

## Run

```sh
pnpm install
pnpm native:build
pnpm dev
```

The first native build downloads a pinned Dawn source tree and creates the Linux x64 addon in `native/gpu/dist/`. On Ubuntu, install the native build prerequisites with `sudo apt install cmake g++ libx11-xcb-dev`; Go must be 1.26 or newer. Set `WGPU_BACKEND` to `vulkan` when needed.

## Demo

The demo cycles through Graphics, Sprite, normal Pixi Text, and an FFmpeg VA-API video scene. It shows a continuously updated FPS overlay in the upper-right corner and logs renderer, adapter, and presentation format. The Sprite uses `assets/test-texture.png`; Text and video frames use the native Skia Canvas2D adapter.

The video test requires a system FFmpeg with VA-API support and an H.264 VA-API decode device. Set `FFMPEG_PATH` to override the executable and `FFMPEG_VAAPI_DEVICE` to override the default `/dev/dri/renderD128` device.

Scenes are selected with `1`–`4`; use the left and right arrow keys to move between scenes. Key-repeat events are ignored.

## Current limitation

The checked-in prebuilt addon targets Linux x64 and Vulkan. Other platforms need their own native build. The native window, renderer, ticker, Sprite, Graphics, and Text path are isolated from the desktop host runtime; there is no WebView or WebGL fallback.
