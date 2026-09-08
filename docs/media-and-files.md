# Media and files

## Module-relative files

Packaged displays should resolve their own assets from `import.meta.url`, not
from `process.cwd()`:

```ts
import { createModuleFileAccess } from "@pixi-native/pixi8/files";

const files = createModuleFileAccess(import.meta.url);
const settings = await files.readJson<{ renderer: "webgpu" | "webgl" }>(
  "../assets/settings.json",
);
const imagePath = files.resolvePath("../assets/logo.png");
```

Relative paths resolve beside the calling module. Absolute paths, Windows drive
paths, UNC paths, and `file:` URLs remain absolute. The helper is intentionally
read-only; use `node:fs` directly for writes and `fetch` for HTTP resources.

After `createApp()`, image textures use Pixi's standard asset pipeline:

```ts
import { Assets, Sprite, createApp } from "@pixi-native/pixi8";

const runtime = await createApp({ backend: "webgpu" });
const texture = await Assets.load(imagePath);
runtime.app.stage.addChild(new Sprite(texture));
```

The native renderer owns pixel format, alpha, and orientation conversion. Do
not call `Assets.init()` or copy an image through a native canvas in application
code. Release cached textures with `Assets.unload(imagePath)` during teardown.

## Native video

`NativeVideo` owns FFmpeg decoding and browser-like playback state.
`VideoSprite` uploads its NV12 frames through the selected Pixi renderer:

```ts
import {
  NativeVideo,
  VideoSprite,
  createApp,
  createModuleFileAccess,
} from "@pixi-native/pixi8";

const files = createModuleFileAccess(import.meta.url);
const runtime = await createApp({ backend: "webgpu" });
const video = new NativeVideo(files.resolvePath("../assets/intro.mp4"), {
  width: 1920,
  height: 1080,
  audio: true,
});
const sprite = new VideoSprite(video);

runtime.app.stage.addChild(sprite);
runtime.addDestroyListener(() => video.destroy());
await video.play();
```

Assigning `video.src` reloads a source while retaining the same `VideoSprite`.
The video API also supports `load()`, `pause()`, seeking through `currentTime`,
`loop`, `playbackRate`, volume/mute controls, media events, live reconnect, and
decoder statistics.

For a video containing a color image on the left and a grayscale alpha mask on
the right, pass the mask width divided by the color width:

```ts
const sprite = new VideoSprite(video, { alphaMaskScale: 0.5 });
```

The color and mask split must retain positive, even widths for NV12 chroma
alignment.

FFmpeg lookup is: explicit `ffmpegPath`, `FFMPEG_PATH`, the installed native
platform package, then development `PATH`. The Windows native package contains
the verified minimal FFmpeg runtime.

## Native audio

The `/audio` entrypoint provides Howler-style `Howl` and `Howler` objects backed
by the native audio engine:

```ts
import { Howl } from "@pixi-native/pixi8/audio";
import { createModuleFileAccess } from "@pixi-native/pixi8/files";

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

Audio supports overlapping voices, sprites, looping, pause/stop/seek, fades,
volume, mute, events, preload, and bounded streaming. Unload caller-owned audio
during application teardown.
