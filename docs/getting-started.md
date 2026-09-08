# Getting started

## Requirements

- Node.js 24.13 or newer from the Node.js 24 LTS line
- Windows 11 x64 or Linux x64
- pnpm 9.15.9 for repository development and the examples below

Install three parts for one display: the neutral core, one Pixi version facade,
and the native package for the target operating system.

### Windows x64 with PixiJS 8

```sh
pnpm add @pixi-native/core @pixi-native/pixi8 @pixi-native/native-win32-x64
```

### Linux x64 with PixiJS 8

```sh
pnpm add @pixi-native/core @pixi-native/pixi8 @pixi-native/native-linux-x64
```

Replace `@pixi-native/pixi8` with `@pixi-native/pixi7` for a PixiJS 7 display.
A launcher that starts both generations installs both facades once, then runs
each display in a separate process.

The project has not published these packages to a public registry. For now, use
the corresponding `.tgz` paths from `artifacts/` in place of package names.
[Deployment](deployment.md) describes the complete archive set.

## PixiJS 8

Import Pixi and the native helpers from the same facade:

```ts
import {
  Assets,
  Sprite,
  createApp,
  createModuleFileAccess,
} from "@pixi-native/pixi8";

const files = createModuleFileAccess(import.meta.url);
const runtime = await createApp({
  backend: "webgpu",
  width: 1280,
  height: 720,
  title: "Pixi Native",
});

const logoPath = files.resolvePath("../assets/logo.png");
const texture = await Assets.load(logoPath);
runtime.app.stage.addChild(new Sprite(texture));
runtime.native.window.setPosition(100, 100);

runtime.addDestroyListener(() => Assets.unload(logoPath));
```

`createApp()` starts the Pixi ticker, native event polling, rendering, and frame
presentation. Native close, `SIGINT`, and `SIGTERM` use the managed teardown
path. Application code can call `await runtime.destroy()` when it owns another
shutdown signal.

PixiJS 8 supports `backend: "webgpu"` and `backend: "webgl"`. Omitting the
option selects WebGPU. The runtime reports an unavailable backend instead of
switching renderers. Call `Assets.load()` after `createApp()` has installed the
native asset environment.

## PixiJS 7

PixiJS 7 exposes the same application shape and uses WebGL:

```ts
import { Graphics, createApp } from "@pixi-native/pixi7";

const runtime = await createApp({
  width: 1280,
  height: 720,
  title: "Pixi 7 Native",
});

const shape = new Graphics();
shape.beginFill(0x4f8cff).drawRoundedRect(40, 40, 240, 120, 16).endFill();
runtime.app.stage.addChild(shape);
```

Do not import `pixi.js`, the internal `pixi.js-v7` alias, or the other Pixi
Native facade in the same display process. Pixi extensions, caches, and plugins
belong to that process's selected major.

## Next steps

- Read [Application lifecycle and API](application-and-api.md) before taking
  manual renderer ownership.
- Read [Media and files](media-and-files.md) for images, video, and audio.
- Read [GSAP integration](integrations/gsap.md) if the display uses GSAP.
