# Application lifecycle and API

## Public package entrypoints

Use one version package as the main facade for a display:

- `@pixi-native/pixi7` exports PixiJS 7, `createApp()`, `createRenderer()`,
  `VideoSprite`, and the neutral core API.
- `@pixi-native/pixi8` exports PixiJS 8 and the matching native API.
- `/audio`, `/files`, `/runtime`, and `/canvas` provide focused entrypoints on
  both version packages.
- `@pixi-native/core` owns Pixi-neutral functionality. Display code can import
  through its version facade in most cases.

Only declared package exports form the public API. The packages do not expose
an `/application` entrypoint. Internal `dist/` paths and repository source paths
may change between releases.

## Managed application lifecycle

`createApp()` is the standard entrypoint. It creates the native window and
renderer, installs the minimal browser-shaped adapter required by Pixi, starts
the ticker, polls input, presents frames, and controls teardown.

```ts
import { createApp } from "@pixi-native/pixi8";

const runtime = await createApp({
  backend: "webgpu",
  width: 1280,
  height: 720,
});

runtime.addDestroyListener(async () => {
  // Release application-owned media, timers, and integrations here.
});

// Call await runtime.destroy() from a custom application shutdown path.
```

Native close, `SIGINT`, and `SIGTERM` enter the same managed shutdown path.
`destroy()` is idempotent. Register caller-owned resources with
`addDestroyListener()` so they stop before the native surface and device.

The returned object contains:

- `app`, the Pixi `Application` for the selected major;
- `native`, the native window, canvas/input surface, and renderer context;
- `destroy()`, the managed asynchronous teardown function;
- `addDestroyListener()`, which registers caller-owned cleanup.

## Renderer selection

PixiJS 8 accepts `backend: "webgpu"` or `backend: "webgl"`. WebGPU is the
default when the option is absent. PixiJS 7 uses WebGL and does not accept a
WebGPU backend.

The requested backend must exist in the installed native package. Startup fails
with a platform or renderer error when it is unavailable. Pixi Native does not
try another backend and does not create a browser renderer.

| Platform       | WebGPU backend | WebGL backend  |
| -------------- | -------------- | -------------- |
| Windows 11 x64 | D3D12          | GLFW/OpenGL ES |
| Linux x64      | Vulkan         | GLFW/OpenGL ES |

## Manual renderer ownership

`createRenderer()` initializes Pixi and the native surface without installing
the managed application loop. The caller then owns event polling, rendering,
presentation, resizing, and cleanup.

```ts
import { createRenderer } from "@pixi-native/pixi8";

const { app, native } = await createRenderer({ backend: "webgpu" });

app.render();
native.renderer.swap();
```

Use `createApp()` unless the application already has a complete frame and
shutdown lifecycle.

## Window and presentation options

Both version facades accept these shared options:

- `title`, `width`, and `height` configure the initial window.
- `x` and `y` set an absolute virtual-desktop position. Supply both values.
- `resizable` and `borderless` control resizing and window decoration.
- `transparent` and `backgroundAlpha` configure compositor transparency where
  the platform supports it.
- `antialiasSamples` accepts `0`, `2`, `4`, or `8` and defaults to `4`. A
  backend may report and use its nearest supported value.
- `vsync` selects synchronized or immediate presentation.
- `maxFps` accepts 24 through 360 and applies when `vsync` is false. VSync
  ignores it and owns frame pacing.

The native window exposes `setPosition()`, `minimize()`, `maximize()`, and
`restore()`. Transparent pixels remain input-active. Click-through behavior and
custom title bars are outside the public API.

Windows uses the compositor path for transparent WebGPU windows. Linux requests
premultiplied alpha from the active compositor; WebGPU selects an opaque surface
and reports that choice when the compositor does not offer it.

## Runtime constraints

The DOM adapter implements the capabilities Pixi needs for rendering, assets,
and pointer or keyboard events. It does not implement HTML layout, CSS,
navigation, browser media elements, or arbitrary web applications. Use the
native APIs described in [Media and files](media-and-files.md).
