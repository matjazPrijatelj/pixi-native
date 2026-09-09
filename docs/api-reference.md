# Pixi Native API reference

This reference covers the stable API added by Pixi Native. PixiJS classes such
as `Application`, `Sprite`, and `Assets` retain their upstream PixiJS API.
Imports below use the PixiJS 8 facade; replace the package root with
`@matjash/pixi-native/pixi7` for PixiJS 7.

## Application and renderer

### `createApp(options?)`

Creates a self-running native application. It initializes the selected Pixi
renderer, starts its ticker, polls native input, presents frames, and installs a
shared teardown path for native close, `SIGINT`, and `SIGTERM`.

```ts
const runtime = await createApp({
  backend: "webgpu",
  title: "Display",
  width: 1280,
  height: 720,
});

runtime.addDestroyListener(() => ownedMedia.destroy());
await runtime.destroy();
```

The returned object exposes:

- `app`: the PixiJS application;
- `native`: the backend-specific native window and renderer context;
- `destroy()`: idempotent asynchronous teardown;
- `addDestroyListener(listener)`: registers caller-owned cleanup and returns a
  function that unregisters that listener.

Destroy listeners run before Pixi and the native surface are released. If more
than one cleanup step fails, `destroy()` completes every step and rejects with
the first error.

### `createRenderer(options?)`

Creates the Pixi application and native renderer without a managed loop. Use it
only when the caller already owns event polling, rendering, presentation, and
shutdown. The returned `native.destroy()` releases the native context.

PixiJS 8 accepts `backend: "webgpu" | "webgl"` and defaults to WebGPU. PixiJS 7
always uses WebGL and does not accept `backend`. An unavailable backend fails at
startup; Pixi Native does not silently select another renderer.

### Shared renderer options

| Option | Meaning |
| --- | --- |
| `title` | Native window title. |
| `width`, `height` | Initial physical-pixel dimensions. |
| `x`, `y` | Absolute virtual-desktop position; provide both together. |
| `resizable` | Allows a decorated window to be resized. |
| `borderless` | Creates an undecorated, non-user-resizable window. |
| `transparent` | Requests compositor transparency. |
| `backgroundAlpha` | Pixi clear alpha; opaque windows normalize it to `1`. |
| `antialiasSamples` | `0`, `2`, `4`, or `8`; defaults to `4`. |
| `vsync` | Selects synchronized or immediate presentation. |
| `maxFps` | Timer-paced limit from 24 to 360 when VSync is disabled. |

The native window exposes `setPosition(x, y)`, `minimize()`, `maximize()`, and
`restore()`. Prefer `runtime.destroy()` over destroying the window directly.

## Files

### `createModuleFileAccess(moduleUrl)`

Creates read-only helpers whose relative paths resolve from the calling module,
not from `process.cwd()`. Pass `import.meta.url`.

```ts
const files = createModuleFileAccess(import.meta.url);
const path = files.resolvePath("../assets/config.json");
const config = await files.readJson<DisplayConfig>(path);
```

| Method | Result |
| --- | --- |
| `resolvePath(source)` | Absolute path without accessing the filesystem. |
| `exists(source)` | `false` only for a missing path; other I/O errors reject. |
| `readBytes(source)` | Complete file as `Uint8Array`. |
| `readText(source, encoding?)` | Complete text, UTF-8 by default. |
| `readJson<T>(source)` | Parsed JSON; syntax errors include the resolved path. |

Sources may be relative paths, absolute paths, UNC paths, or `file:` URLs.
Network URLs are rejected.

## Audio

Import audio from the matching version facade:

```ts
import { Howl, Howler, nativeAudioEngine } from "@matjash/pixi-native/pixi8/audio";
```

### `new Howl(options)`

A `Howl` owns one source and any number of overlapping voices. `src` is required;
when an array is supplied, the first source is currently used. Volume values are
between `0` and `1`. Sprite entries use `[offsetMs, durationMs, loop?]`.

Important options include `sprite`, `volume`, `mute`, `loop`, `autoplay`,
`preload`, `preloadSprites`, `html5`, and `rate`. `html5: true` selects bounded
FFmpeg streaming. The `ffmpegInputArgs` and `ffmpegOutputArgs` options are for
native media integrations and should not be needed for ordinary effects.

### Howl playback and state

| Method | Behavior |
| --- | --- |
| `load()` | Starts preloading once and returns the `Howl`. |
| `play()` | Starts the complete source and returns its sound ID. |
| `play(sprite)` | Starts a named sprite and returns its sound ID. |
| `play(id)` | Resumes a paused ID. Returns `-1` for an unknown ID. |
| `pause(id?)` | Pauses one ID or every voice in the group. |
| `stop(id?)` | Stops one ID or every voice in the group. |
| `playing(id?)` | Reports whether one ID or any group voice is playing. |
| `state()` | Returns `"unloaded"`, `"loading"`, or `"loaded"`. |
| `duration(id?)` | Sprite duration in seconds; unsprited sources return `0`. |
| `unload()` | Permanently stops and releases this `Howl`; returns `null`. |

After `unload()`, methods that require a usable instance throw. Register
caller-owned Howls with `runtime.addDestroyListener()`.

### Howl volume, mute, loop, seek, and fade

Getter overloads return the group value when no ID is supplied. Setter
overloads affect one ID when supplied or the group and its active voices when
omitted. Setters return the `Howl` for chaining.

| Method | Units and range |
| --- | --- |
| `volume()` / `volume(value, id?)` | `0` through `1`. |
| `mute()` / `mute(value, id?)` | Boolean. |
| `loop()` / `loop(value, id?)` | Boolean. |
| `seek()` / `seek(id)` | Returns seconds relative to the sprite start. |
| `seek(seconds, id?)` | Non-negative finite seconds. |
| `fade(from, to, durationMs, id?)` | Volumes `0` through `1`; duration in milliseconds. |

Invalid volume, seek, rate, or fade values throw `RangeError`.

### Howl events

Use `on(event, callback, id?)`, `once(event, callback, id?)`, and
`off(event?, callback?, id?)`. A callback receives `(id?, message?)`; the
message is normally present for an error.

Supported events are `load`, `loaderror`, `playerror`, `play`, `end`, `pause`,
`stop`, `mute`, `volume`, `seek`, and `fade`. Constructor options named
`onload`, `onplayerror`, and so on register the same listeners. Calling `off()`
without an event removes every listener owned by that Howl.

### `Howler`

`Howler` controls all Howls in the process:

- `volume()` reads global volume and `volume(value)` sets it;
- `mute(value)` changes global mute;
- `stop()` stops every active voice but keeps Howl instances usable;
- `unload()` unloads every Howl and shuts down the audio backend;
- `codecs(extension)` reports whether the packaged FFmpeg configuration
  recognizes the extension.

`nativeAudioEngine.diagnostics` is a read-only monitoring snapshot containing
`activeVoices`, `queuedMs`, and `underruns`. Voice creation, worker commands,
and backend shutdown are deliberately not public through this object.

## Video

`NativeVideo` supplies decoded NV12 frames and browser-shaped playback state.
`VideoSprite` presents those frames through the selected Pixi renderer.

```ts
const video = new NativeVideo(videoPath, {
  width: 1920,
  height: 1080,
  fps: 30,
  audio: true,
});
const sprite = new VideoSprite(video);
runtime.app.stage.addChild(sprite);
await video.play();
```

`NativeVideo` provides mutable `src`, `currentTime`, `loop`, `playbackRate`,
`volume`, and `muted`, plus read-only `currentSrc`, `duration`, `readyState`,
`paused`, `ended`, `backend`, `error`, `audioError`, `reconnecting`,
`reconnectAttempts`, and `stats`.

| Method | Behavior |
| --- | --- |
| `play()` | Loads metadata if needed and starts or resumes playback. |
| `pause()` | Pauses at the current position. |
| `load()` | Fully resets and reloads the current source. |
| `destroy()` | Idempotently releases video decoder and audio resources. |

Changing `src` resets readiness, errors, dimensions, playback state, and
statistics. File sources support seeking and positive finite playback rates.
Live sources cannot seek and require playback rate `1`; optional reconnect uses
bounded exponential delay configured by `initialDelayMs` and `maxDelayMs`.

PixiJS 8 `VideoSprite.destroy()` releases sprite GPU resources but leaves the
video owned by the caller. PixiJS 7 currently destroys its owned video together
with the sprite. Packed-alpha video uses `alphaMaskScale` to describe the width
of the right-hand alpha strip relative to the left-hand color image.

## Runtime and canvas

The `/runtime` and `/canvas` entrypoints exist for applications that integrate
their own loop or native surface. Standard displays normally need only
`createApp()` and the returned `native` context.

- `NodeCanvas` wraps native Canvas2D and exposes premultiplied RGBA pixels.
- `NodeGLCanvas` wraps WebGL2, dispatches translated events, and resizes its
  native drawing buffer.
- `NodeGPUCanvas` exposes the native WebGPU canvas context, translated events,
  and presentation-surface resizing.
- `FrameScheduler` and `VSyncFrameScheduler` provide request/cancel/dispose
  lifecycle for custom loops.
- `NodeDOMAdapter` is the minimal Pixi environment adapter; call `dispose()`
  before releasing the native surface when managing it directly.

Renderer-specific upload helpers and native binding resolvers are implementation
integration points. They are not required for normal application code and may
change as renderer backends evolve.
