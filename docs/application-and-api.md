# Application and API

## Package entrypoints

Use one version package as the main application facade:

- `@pixi-native/pixi7` exports PixiJS 7, `createApp`, `createRenderer`,
  `VideoSprite`, and the neutral core API.
- `@pixi-native/pixi8` exports PixiJS 8 and the equivalent native API.
- `/audio`, `/files`, `/runtime`, and `/canvas` are supported focused
  entrypoints on both version packages.
- `@pixi-native/core` owns Pixi-neutral functionality. Most display code should
  import through its selected version package instead.

Only package exports are public. Internal `dist/` paths and repository source
paths may change without compatibility guarantees.

## Managed application lifecycle

`createApp()` is the normal entrypoint. It initializes the native window and
renderer, installs the minimal browser-like surface required by Pixi, starts the
Pixi ticker, polls native events, presents frames, and owns teardown.

```ts
import { createApp } from "@pixi-native/pixi8";

const runtime = await createApp({ backend: "webgpu" });

runtime.addDestroyListener(async () => {
  // Release application-owned resources before native teardown.
});

await runtime.destroy();
```

`destroy()` is idempotent. A native close event, `SIGINT`, and `SIGTERM` enter
the same teardown path. Register external timers, media, or integrations with
`addDestroyListener()` instead of maintaining a competing process shutdown path.

The returned values are:

- `app`: the normal Pixi `Application` for the selected major version;
- `native`: the native window, canvas/input surface, and renderer context;
- `destroy()`: managed asynchronous teardown;
- `addDestroyListener()`: lifecycle registration for caller-owned resources.

## Manual renderer ownership

`createRenderer()` initializes Pixi and the native surface but does not install
the managed application loop. Use it only when the caller intentionally owns
event polling, rendering, presentation, resizing, and cleanup.

```ts
import { createRenderer } from "@pixi-native/pixi8";

const { app, native } = await createRenderer({ backend: "webgpu" });

// The caller now owns its frame loop and teardown order.
app.render();
native.renderer.swap();
```

Prefer `createApp()` unless manual ownership is a firm architectural
requirement.

## Window and presentation options

Both version packages accept the shared native window options:

- `title`, `width`, and `height` configure the initial window;
- `x` and `y` set an absolute virtual-desktop position and must be supplied
  together;
- `resizable` and `borderless` control window decoration and resizing;
- `transparent` and `backgroundAlpha` configure compositor transparency where
  supported;
- `antialiasSamples` accepts `0`, `2`, `4`, or `8` and defaults to `4`;
- `vsync` selects synchronized or immediate presentation;
- `maxFps` applies only to timer-paced rendering when `vsync` is false.

PixiJS 8 additionally requires an explicit `backend` choice when the default
WebGPU backend is not desired. PixiJS 7 is WebGL-only.

The native window exposes `setPosition()`, `minimize()`, `maximize()`, and
`restore()`. Per-pixel transparent areas still receive mouse input; click-through
and custom title-bar behavior are not part of the public API.

## Runtime constraints

The installed DOM adapter implements only the browser capabilities Pixi needs.
It is not an HTML layout engine and does not provide navigation, CSS, browser
media elements, or arbitrary web applications. Use native media and filesystem
entrypoints documented in [Media and files](media-and-files.md).
