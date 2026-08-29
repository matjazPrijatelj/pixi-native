Create a new experimental project that proves PixiJS v8 can render directly into an Electrobun native WGPU surface without using a browser WebView for rendering.

## Goal

Build the smallest possible working proof of concept using:

* Electrobun
* Bun 1.4.x
* latest stable PixiJS v8, currently `pixi.js@8.20.0`
* Electrobun `bundleWGPU: true`
* PixiJS `WebGPURenderer`
* native Electrobun `GpuWindow` or `WGPUView`
* TypeScript

The application must render directly through Electrobun's bundled Dawn/WebGPU implementation.

Do NOT use CEF, WebView2 or an HTML canvas as the final rendering target.

## Important architectural constraint

PixiJS must use the same `GPUAdapter`, `GPUDevice` and native surface/context created through Electrobun's bundled WebGPU implementation.

Do not create a second browser-owned WebGPU device.

Use Electrobun's existing Three.js/Babylon WGPU examples as reference implementations for how Electrobun exposes its native WebGPU adapter/device/context to third-party renderers.

Relevant Electrobun concepts:

* `bundleWGPU: true`
* `GpuWindow`
* `WGPUView`
* `webgpu.createContext(...)`
* bundled Dawn WebGPU implementation
* existing `wgpu-threejs` and `wgpu-babylon` templates/examples

## First milestone

Open one native GPU window, approximately 1280x720.

Render with PixiJS:

1. A colored background.
2. Several `Graphics` primitives:

   * rectangle
   * rounded rectangle
   * circle
   * line
3. One Pixi `Sprite`.
4. One normal Pixi `Text`, NOT `BitmapText`.
5. Animate at least one Graphics object and the Sprite using Pixi's ticker.

Expected visual example:

* dark background
* moving sprite
* rotating rectangle
* circle
* text saying:
  `PixiJS 8.20 + Electrobun Native WGPU`

Maintain a stable render loop.

## Pixi initialization

Prefer the PixiJS WebGPU renderer explicitly.

Conceptually the initialization should resemble:

```ts
const app = new Application();

await app.init({
    preference: "webgpu",
    gpu: {
        adapter,
        device,
    },
    // custom native surface/canvas adapter as necessary
});
```

Do not assume this exact API is sufficient.

Inspect PixiJS 8.20 source and types and determine the correct integration points.

The objective is to inject Electrobun's existing GPU adapter/device/context into Pixi rather than letting Pixi create its own browser WebGPU environment.

## Native surface adapter

Implement the smallest compatibility layer necessary for Pixi's WebGPU renderer.

Investigate what Pixi expects from:

* canvas
* `GPUCanvasContext`
* width / height
* devicePixelRatio
* resize
* presentation format
* `configure()`
* `getCurrentTexture()`

Map these operations onto Electrobun's native WGPU surface/context.

Do not emulate a complete browser DOM.

Keep this adapter isolated in something like:

```text
src/pixi-electrobun/
    ElectrobunCanvas.ts
    ElectrobunDOMAdapter.ts
    createPixiRenderer.ts
```

The adapter must be generic enough that it could later become a reusable Pixi/Electrobun package.

## Text support is mandatory

Normal Pixi:

```ts
new Text(...)
```

must work.

Do not solve the requirement by replacing it with `BitmapText`.

Pixi's normal Text implementation uses Canvas2D-based text rasterization internally, so the native Bun environment will not automatically provide all browser DOM APIs that Pixi expects.

Investigate PixiJS 8.20 `DOMAdapter`, text systems and canvas creation code.

Implement the smallest environment adapter required for `Text`.

First determine precisely which APIs Pixi Text actually requires.

Likely requirements include some subset of:

```text
createCanvas()
CanvasRenderingContext2D
measureText()
font
textBaseline
textAlign
fillText()
strokeText()
clearRect()
getImageData()
canvas.width
canvas.height
```

Do NOT implement unused DOM APIs unless Pixi requires them.

## Canvas2D implementation

For normal `Text`, choose a native/offscreen Canvas2D implementation that works under Bun without a browser.

Prefer an implementation that:

* works on Windows
* can load TTF/OTF fonts
* supports `measureText`
* supports fill/stroke text
* gives access to RGBA pixel data or another form Pixi can upload
* has acceptable performance

Possible approaches to investigate:

1. Bun 1.4 native image/canvas capabilities if sufficient.
2. A lightweight native Canvas2D-compatible package.
3. Skia-based implementation.
4. A minimal custom text rasterization backend.

Do not silently fall back to a WebView.

If no suitable Canvas2D implementation exists, document the limitation clearly and implement a focused text rasterizer adapter rather than adding an entire browser environment.

## Graphics support

Pixi `Graphics` should use Pixi's existing WebGPU Graphics implementation.

Do not implement Graphics drawing manually.

If Graphics fails, identify which browser assumptions or Pixi renderer assumptions cause it and fix the adapter.

We want to preserve normal Pixi application code such as:

```ts
const graphics = new Graphics()
    .rect(0, 0, 200, 100)
    .fill(0xff0000);
```

## DOMAdapter

Use Pixi's environment abstraction rather than monkey-patching global browser objects whenever possible.

Investigate:

```ts
DOMAdapter
```

and create something similar to:

```ts
DOMAdapter.set(new ElectrobunDOMAdapter());
```

Only implement methods actually required by this PoC.

Avoid installing globals like:

```ts
globalThis.document = ...
globalThis.window = ...
```

unless Pixi cannot reasonably be adapted otherwise.

If a global shim is unavoidable, explain why in comments.

## Resize support

Resize the Pixi renderer correctly when the native Electrobun window changes size.

The native WGPU surface/context must be reconfigured as required.

Do not recreate the entire Pixi Application on every resize.

## Project structure

Use a clean structure similar to:

```text
pixi-electrobun-wgpu/
├─ package.json
├─ bun.lock
├─ tsconfig.json
├─ electrobun.config.ts
└─ src/
   ├─ main.ts
   ├─ demo/
   │  └─ DemoScene.ts
   └─ pixi-electrobun/
      ├─ ElectrobunCanvas.ts
      ├─ ElectrobunDOMAdapter.ts
      ├─ ElectrobunTextCanvas.ts
      ├─ createPixiRenderer.ts
      └─ index.ts
```

Adjust names if Electrobun's current project layout requires something different.

## Dependencies

Use exact versions where practical.

At minimum:

```json
{
  "pixi.js": "8.20.0"
}
```

Use the current stable Electrobun package/template version generated by the current Electrobun tooling.

Target Bun 1.4.x.

Do not add React, Vue, Vite or another UI framework.

## Debugging requirements

Add useful startup diagnostics:

```text
Bun version
PixiJS version
selected GPU adapter
selected backend if available
GPU limits
surface format
window size
devicePixelRatio
```

Log whether Pixi is actually using WebGPU.

The application should fail loudly if Pixi falls back to WebGL.

WebGL fallback is NOT acceptable for this experiment.

## Performance instrumentation

Add a simple FPS/frame-time counter.

Every five seconds print approximately:

```text
FPS
average frame time
max frame time
renderer type
```

No sophisticated benchmark is required yet.

## Do not implement yet

Do NOT add:

* RTP
* multicast sockets
* N-API
* video decoding
* FFmpeg
* D3D11VA
* NVDEC
* shared textures
* WebCodecs
* Electron
* CEF

Those are future phases.

This first project exists only to prove:

```text
PixiJS 8
   ↓
WebGPURenderer
   ↓
Electrobun bundled Dawn GPUDevice
   ↓
Electrobun native WGPU surface
```

while retaining:

```text
Sprite
Graphics
Text
Ticker
```

## Success criteria

The experiment succeeds only if all of these are true:

1. No WebView is used for rendering.
2. Pixi reports WebGPU renderer.
3. Electrobun's bundled WGPU/Dawn device is used.
4. Sprite renders correctly.
5. Graphics renders correctly.
6. Standard Pixi `Text` renders correctly.
7. Text supports at least:

   * font family
   * font size
   * fill color
   * stroke
   * alignment
8. Animation works continuously.
9. Window resize works.
10. No WebGL fallback occurs.
11. No browser or hidden CEF window is used for text rasterization.

## Development strategy

Work incrementally.

Commit/logically separate the work into these stages:

### Stage 1

Electrobun native WGPU window with a raw WebGPU clear color.

### Stage 2

Create/inject Electrobun GPU adapter/device into Pixi.

Render an empty Pixi stage.

### Stage 3

Render Sprite.

### Stage 4

Render Graphics.

### Stage 5

Implement Pixi environment/DOM adapter.

### Stage 6

Get normal Pixi Text working.

### Stage 7

Resize + ticker + diagnostics.

Do not jump directly to Text before proving that Pixi's WebGPU renderer can present into the Electrobun native surface.

## Research rule

Before writing compatibility shims, inspect the current source code of:

* PixiJS 8.20 WebGPURenderer
* PixiJS DOMAdapter
* PixiJS CanvasTextSystem / Text systems
* PixiJS texture upload paths
* Electrobun wgpu-threejs example
* Electrobun wgpu-babylon example
* Electrobun WebGPU adapter/context implementation

Prefer using existing extension points over patching Pixi internals.

If Pixi requires a small upstream change to allow an external native `GPUCanvasContext`, isolate that patch and document it.

Do not fork Pixi unless absolutely necessary.

## Final deliverable

At the end, provide:

1. Working source code.
2. Exact commands to install and run.
3. Short architecture explanation.
4. List of compatibility shims required.
5. Any Pixi internals that had to be patched.
6. Remaining blockers.
7. Recommendation whether this approach is suitable for the next phase:
   native RTP → hardware decode → shared GPU texture → Pixi WebGPU.

use pnpm 9.15.9
