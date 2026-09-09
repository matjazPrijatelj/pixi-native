# Getting started

## Requirements

- Node.js 24.13 or newer from the Node.js 24 LTS line
- Windows 11 x64 or Linux x64
- pnpm 9.15.9 for repository development and the examples below

Configure GitHub Packages in the consumer's `.npmrc`:

```ini
@matjazprijatelj:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Use a classic GitHub personal access token with `read:packages`, then install
the facade package:

```sh
pnpm add @matjazprijatelj/pixi-native pixi.js@^8.20.0
# PixiJS 7 instead:
pnpm add @matjazprijatelj/pixi-native pixi.js-v7@npm:pixi.js@^7.4.3
```

npm selects the matching Windows or Linux x64 native dependency. Pixi itself is
an optional peer: install only the major used by the display. The root import
uses PixiJS 8. Use `/pixi7` for a PixiJS 7 display. A launcher can install both
Pixi dependencies and run both generations when each display has its own
process.

## Generate a project

Create a PixiJS 8 WebGPU starter after configuring GitHub Packages:

```sh
pnpm dlx @matjazprijatelj/create-pixi-native my-display --pixi 8 --backend webgpu
cd my-display
pnpm install
pnpm dev
```

The generator also accepts `--backend webgl`. Use `--pixi 7` for the PixiJS 7
WebGL template. Generated projects use Node watch mode during development,
TypeScript for compiled output, and Prettier for formatting.

## PixiJS 8

Import Pixi and the native helpers from the same facade:

```ts
import {
  Assets,
  Sprite,
  createApp,
  createModuleFileAccess,
} from "@matjazprijatelj/pixi-native";

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
import { Graphics, createApp } from "@matjazprijatelj/pixi-native/pixi7";

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
