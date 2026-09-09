# GSAP integration

GSAP is optional and is not installed by any Pixi Native package. Add it to the
display application that uses it:

```sh
pnpm add gsap
```

## Initialize after the native application

Create the native application before dynamically importing GSAP. The
initializer installs the animation-frame globals required by GSAP in this
headless Node.js process.

The example below uses PixiJS 8. For PixiJS 7, change the namespace import to
`@matjash/pixi-native/pixi7` and omit the WebGPU backend option.

```ts
import * as PIXI from "@matjash/pixi-native";

const runtime = await PIXI.createApp({ backend: "webgpu" });
const [{ gsap }, { PixiPlugin }] = await Promise.all([
  import("gsap"),
  import("gsap/PixiPlugin"),
]);

PixiPlugin.registerPIXI(PIXI);
gsap.registerPlugin(PixiPlugin);
```

Register PixiPlugin once per display process against that process's matching
Pixi namespace. Do not register PixiJS 7 and PixiJS 8 in the same process.

PixiPlugin is needed for its Pixi-specific property syntax:

```ts
const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
runtime.app.stage.addChild(sprite);

gsap.to(sprite, {
  duration: 1,
  repeat: -1,
  yoyo: true,
  pixi: { rotation: 180, alpha: 0.35 },
});
```

GSAP can animate ordinary object properties without PixiPlugin. The plugin is
only required when using the `pixi` property shown above.

## Keep GSAP moving during native modal frames

GSAP has an independent ticker. On Windows, moving or resizing a native window
enters a modal event loop, so forward the native modal-frame signal to GSAP and
register cleanup with the managed application:

```ts
const removeModalFrameListener = runtime.native.addModalFrameListener?.(() => {
  gsap.ticker.tick();
});

if (removeModalFrameListener) {
  runtime.addDestroyListener(removeModalFrameListener);
}
```

This listener supplements GSAP's normal animation-frame scheduling only during
the native modal loop. Do not add a second permanent render loop.

Clean up caller-owned timelines when their scene is removed:

```ts
const timeline = gsap.timeline({ repeat: -1 });
timeline.to(sprite, { x: 400, duration: 1 });

runtime.addDestroyListener(() => timeline.kill());
```

The repository demos use the same bridge and provide runnable PixiJS 7 and 8
examples.
