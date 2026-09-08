# Getting started

## Requirements

- Node.js 24.13 or newer from the Node.js 24 LTS line
- pnpm 9.15.9
- Windows 11 x64 for the currently packaged native runtime

Install the neutral runtime, one or both Pixi version packages, and the native
package for the target platform. A launcher that hosts both display generations
installs all four packages once:

```sh
pnpm add @pixi-native/core @pixi-native/pixi7 @pixi-native/pixi8 @pixi-native/native-win32-x64
```

The packages are currently distributed as private tarballs. Replace the names
above with the corresponding `.tgz` paths when installing a local release.

## PixiJS 8

Import Pixi itself and the native helpers from the same version package:

```ts
import { Sprite, createApp, createModuleFileAccess } from "@pixi-native/pixi8";

const files = createModuleFileAccess(import.meta.url);
const { app, native, destroy } = await createApp({
  backend: "webgpu",
  width: 1280,
  height: 720,
  title: "Pixi Native",
});

app.stage.addChild(Sprite.from(files.resolvePath("../assets/logo.png")));
native.window.setPosition(100, 100);

// Optional explicit shutdown. Native close, SIGINT, and SIGTERM use the same path.
await destroy();
```

PixiJS 8 supports `backend: "webgpu"` and `backend: "webgl"`. Renderer selection
is explicit; the runtime does not silently fall back to another backend.

## PixiJS 7

PixiJS 7 uses the same compact application API and a WebGL renderer:

```ts
import { Graphics, createApp } from "@pixi-native/pixi7";

const { app, destroy } = await createApp({
  width: 1280,
  height: 720,
  title: "Pixi 7 Native",
});

const shape = new Graphics();
shape.beginFill(0x4f8cff).drawRoundedRect(40, 40, 240, 120, 16).endFill();
app.stage.addChild(shape);

await destroy();
```

Do not import `pixi.js`, `pixi.js-v7`, or a second Pixi Native version package
inside the same display process. The launcher may install both versions because
each display runs as a separate Node.js process.

## Next steps

- Read [Application and API](application-and-api.md) before taking manual
  renderer ownership.
- Read [Media and files](media-and-files.md) for packaged assets, video, and
  audio.
- Read [GSAP integration](integrations/gsap.md) if the display uses GSAP.
