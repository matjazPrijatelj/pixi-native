# Media and files

## Module-relative files

Resolve packaged assets from `import.meta.url` instead of `process.cwd()`:

```ts
import { createModuleFileAccess } from "@matjash/pixi-native/pixi8/files";

const files = createModuleFileAccess(import.meta.url);
const settings = await files.readJson<{ renderer: "webgpu" | "webgl" }>(
  "../assets/settings.json",
);
const imagePath = files.resolvePath("../assets/logo.png");
```

The helper exposes `resolvePath()`, `exists()`, `readBytes()`, `readText()`, and
`readJson<T>()`. Relative paths resolve beside the calling module. Absolute
paths, Windows drive paths, UNC paths, and `file:` URLs stay absolute.

This API is read-only. Use `node:fs` for writes and `fetch` for HTTP resources.
The focused `/files` entrypoint does not initialize Pixi, a GPU device, or a
native window.

## Images and Canvas2D

`createApp()` and `createRenderer()` install Pixi's native asset environment.
Use the standard Pixi asset pipeline after either initializer completes:

```ts
import { Assets, Sprite, createApp } from "@matjash/pixi-native";

const runtime = await createApp({ backend: "webgpu" });
const texture = await Assets.load(imagePath);
runtime.app.stage.addChild(new Sprite(texture));

runtime.addDestroyListener(() => Assets.unload(imagePath));
```

Application code does not need `Assets.init()` or a manual Canvas2D texture
copy. The renderer handles pixel format, premultiplied alpha, and orientation.
The native Canvas2D adapter also backs normal Pixi text and runtime bitmap-font
atlases.

## Native video

`NativeVideo` controls FFmpeg decoding and browser-shaped playback state.
`VideoSprite` uploads NV12 frames through the selected Pixi renderer:

```ts
import {
  NativeVideo,
  VideoSprite,
  createApp,
  createModuleFileAccess,
} from "@matjash/pixi-native";

const files = createModuleFileAccess(import.meta.url);
const runtime = await createApp({ backend: "webgpu" });
const video = new NativeVideo(files.resolvePath("../assets/intro.mp4"), {
  width: 1920,
  height: 1080,
  audio: true,
  logDiagnostics: true,
});
const sprite = new VideoSprite(video);

runtime.app.stage.addChild(sprite);
runtime.addDestroyListener(() => video.destroy());
await video.play();
```

By default, CPU NV12 delivery (including Pixi 8 WebGL) uses the bundled FFmpeg
CLI, which has the smoother CPU-transfer pipeline. Pixi 8 WebGPU's `gpu-nv12`
delivery uses the in-process libavcodec decoder to retain native GPU surfaces.
Set the process-wide `PIXI_NATIVE_VIDEO_BACKEND=lib` or `cli` to force a
specific implementation for diagnostics; the selection cannot vary per video.

The public video API supports:

- file and live sources, source replacement through `src`, and live reconnect;
- `load()`, `play()`, `pause()`, looping, volume, mute, and playback-rate
  control;
- seeking through `currentTime` for file sources;
- browser-style media events, decoder state, and frame statistics.

Windows uses D3D11VA when available and falls back to CPU decoding. Linux uses
VA-API when available and has the same CPU fallback. Both platform packages
contain the project's minimal FFmpeg and FFprobe executables.

The in-process `lib` implementation uses FFmpeg 8 and D3D11VA on Windows.
PixiJS 8 WebGPU copies each decoder array slice into a shareable NV12 texture entirely
on the GPU, imports it into Dawn/D3D12, and samples its Y and UV planes in the
Pixi shader. No frame bytes pass through CPU memory or JavaScript on that path.
If shared-texture import is unavailable or fails, playback restarts with CLI
CPU NV12 delivery. The in-process implementation supports full-file looping at
rate `1` without custom FFmpeg arguments. CPU delivery, bounded segments, live
input, playback-rate changes, and custom arguments therefore use CLI unless
`PIXI_NATIVE_VIDEO_BACKEND=lib` explicitly overrides that policy.

For repeatable Windows WebGL comparisons, run
`pnpm video:benchmark:webgl -- --duration-seconds 30 --asset 4k_60fps.mp4`.
It writes one log per decoder and `summary.json` beneath
`artifacts/video-benchmarks/`. To build the optional Linux in-process decoder
from WSL, run `pnpm native:video:build:linux:lib:wsl`; it builds the matching
shared FFmpeg 8 SDK first and stages its required shared libraries with the
Linux native package.

Set `logDiagnostics: true` to emit one structured message after the renderer
presents the first frame. `implementationBackend` distinguishes CLI from
in-process libavcodec. `D3D11VA` or `VA-API` with `hardwareDecode: true`
confirms hardware decoding. `deliveryPath: "gpu-nv12"` and `cpuFrameBytes: 0`
confirm GPU delivery; `gpuFrameCopies` counts the required presentation copies.
`zeroCopy` remains false because that D3D11 GPU-to-GPU copy still exists.

FFmpeg lookup checks an explicit `ffmpegPath`, `FFMPEG_PATH`, the installed
native platform package, and then development `PATH`.

### Packed-alpha video

A video can store color on the left and a grayscale alpha mask on the right.
Pass the mask width divided by the color width:

```ts
const sprite = new VideoSprite(video, { alphaMaskScale: 0.5 });
```

The color and mask regions must have positive, even widths for NV12 chroma
alignment. The shader samples both regions without converting the full frame to
RGBA on the CPU.

### Video limits

- Output uses SDR BT.709 limited-range NV12.
- Decoder output reaches the renderer through a CPU-visible frame copy.
- Live sources do not support seeking and require playback rate `1`.

## Native audio

The `/audio` entrypoint provides Howler-style `Howl` and `Howler` objects:

```ts
import { Howl } from "@matjash/pixi-native/pixi8/audio";
import { createModuleFileAccess } from "@matjash/pixi-native/pixi8/files";

const files = createModuleFileAccess(import.meta.url);
const effects = new Howl({
  src: files.resolvePath("../assets/effects.wav"),
  sprite: {
    win: [0, 1200],
    lose: [1500, 900],
  },
});

effects.play("win");
```

Audio supports overlapping voices, sprites, looping, pause, stop, seek, fades,
volume, mute, events, preload, and bounded FFmpeg streaming. Windows uses the
native miniaudio addon. Linux uses the miniaudio PulseAudio/ALSA backend.

The [API reference](api-reference.md#audio) lists every supported `Howl` and
`Howler` method, overload, event, unit, and teardown rule.

Unload caller-owned audio during application teardown:

```ts
runtime.addDestroyListener(() => effects.unload());
```
