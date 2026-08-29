# Development History

## 2026-08-29 — Initial implementation

- Added the Electrobun Bun entrypoint and `bundleWGPU` configuration for macOS, Windows, and Linux.
- Added pinned `pixi.js@8.20.0`, Electrobun 2.0.1, TypeScript, and pnpm 9.15.9 metadata.
- Added native WebGPU setup using `GpuWindow`, `webgpu.createContext()`, the shared adapter/device, and the maintained canvas shim.
- Added Pixi renderer validation that throws on non-WebGPU fallback.
- Added isolated canvas/DOM adapter modules, demo Graphics/Sprite/Text scene, ticker animation, and five-second performance diagnostics.
- Validation pending: Bun is not installed in the current environment, so dependency installation, typechecking, build, and native-window smoke tests remain to be run on a Bun-capable machine.

## Validation update — 2026-08-29

- `pnpm install` completed successfully with pnpm 9.15.9.
- `pnpm typecheck` completed successfully after adding local ambient typings for Electrobun's Hutch bootstrap package.
- Replaced the network-loaded Bunny asset with Pixi's built-in `Texture.WHITE`, keeping the demo offline and deterministic.
- Native `electrobun dev`/`build` and runtime rendering remain pending because Bun is not installed in this environment.
- `pnpm build` completed successfully; Hutch provisioned Electrobun 2.0.1, Cottontail 0.5.0, and Bun 1.4.0 for linux-x64 and produced `build/dev-linux-x64`.
- Runtime window/surface presentation and Pixi Text rasterization still require an interactive native launch (`pnpm dev`) on a machine with a usable GPU/display.

## Runtime fix update — 2026-08-29

- Fixed Pixi's `DOMAdapter` contract by adding `getNavigator()` and all required adapter methods.
- Added the minimal unavoidable native document shim for Pixi's `DOMPipe`, plus `requestAnimationFrame`/`cancelAnimationFrame` scheduling shims.
- Added standard WebGPU enum globals required by Pixi's WebGPU systems.
- Native launch progressed through renderer initialization; Pixi reports renderer type `2`, which is Pixi's WebGPU enum. The fallback guard was corrected accordingly.

## Runtime fix update — 2026-08-29 (continued)

- Added a guarded Pixi `GpuEncoderSystem.setStencilReference()` compatibility layer for the Electrobun Linux wrapper, whose render-pass encoder omits that WebGPU method.
- Confirmed native startup reaches Pixi WebGPU renderer creation (`renderer: "2"`, `format: "bgra8unorm"`).

## Runtime fix update — 2026-08-29 (continued)

- Added explicit `maxTextures: 8` to avoid Pixi 8.20's WebGL-only max-texture probe when constructing its shared batcher in a native WebGPU process.

- Added an explicit post-init `maxTextures`/`maxBatchableTextures` limit because the Electrobun wrapper leaves Pixi GPU limits unset and Pixi otherwise enters its WebGL probe.

## Runtime validation — 2026-08-29 (Text blocker)

- Native smoke test now reaches Pixi WebGPU renderer and first scene render.
- Remaining blocker: Electrobun `createCanvasShim()` returns `null` for a `2d` context on Linux, so Pixi normal `Text` cannot rasterize and fails during `CanvasTextMetrics.measureFont()`.
- Added an explicit startup warning for this missing Canvas2D backend. A pure native Canvas2D/text rasterizer is still required to meet the README Text success criterion; no WebView fallback was introduced.

## Skia integration — 2026-08-30

- Added `skia-canvas@3.0.8` and isolated `ElectrobunTextCanvas` wrapper for Pixi Text.
- Configured `skia-canvas` as an Electrobun external native dependency to preserve its platform binary.

- Corrected native dependency configuration: `skia-canvas` is externalized under `build.bun.external` per Electrobun config schema.

- Added a probe-only WebGL context response for Pixi shader capability detection; the application renderer remains explicitly WebGPU and rejects fallback.

- Added RGBA upload fallback through `queue.writeTexture()` for wrappers without `copyExternalImageToTexture()`.

- Hardened the RGBA upload fallback against WebGPU copy-size tuple/object variations and missing source dimensions.

## Skia runtime validation — 2026-08-30

- `skia-canvas@3.0.8` loads successfully when configured under `build.bun.external`.
- Pixi normal `Text` now rasterizes through Skia and reaches the WebGPU texture upload path; the prior missing Canvas2D context error is resolved.
- Remaining native runtime blockers observed on Linux: Electrobun reports an invalid Pixi vertex stride (`attribute offset ... must be <= vertex buffer stride`) and repeated `NaN` render-pass clear values. These require a separate Pixi/Electrobun WGPU layout investigation.

## Descriptor diagnostics — 2026-08-30

- Added non-invasive logging around `device.createRenderPipeline()` and `beginRenderPass()`.
- Vertex stride/offset alignment and finite clear values are now validated before native WebGPU calls.

## Descriptor diagnosis — 2026-08-30

- Instrumentation proves Pixi emits finite clear values (`[0.0627451, 0.0823529, 0.1333333, 1]`), while Dawn receives `NaN`; this identifies an Electrobun bridge conversion defect.
- Instrumentation proves Pixi emits vertex buffer `arrayStride: 24` with `unorm8x4` at offset 16, while native validation reports `float32x3`; this identifies a native vertex-format mapping defect.
- Added a compatibility normalization that converts Pixi clear-value arrays to `{r,g,b,a}` objects before the native call.


## Latest native smoke result — 2026-08-30

- Clear-value normalization removed the Dawn `clearValue: NaN` validation errors during startup.
- The remaining failure is the Electrobun vertex-format bridge: Pixi sends legal `unorm8x4` data at offset 16 with a 24-byte stride, while Dawn receives it as `float32x3` and rejects the pipeline.
- No Pixi-specific geometry workaround was added; the native bridge mapping must be corrected so other WebGPU clients remain spec-compatible.


## Vertex format bridge workaround — 2026-08-30

- Added a temporary wrapper-side mapping for packed WebGPU vertex formats (unorm8x4, uint16x2, and related formats) to numeric WGPU enum values before Electrobun native calls.
- This bypasses the generated bridge fallback to float32x3 without changing Pixi geometry.
- The long-term fix remains updating Electrobun upstream mapVertexFormat and removing this compatibility layer once that release is available.


- Corrected packed vertex enum values to Electrobun/Dawn’s 1-based WGPU numbering after native validation identified the initial zero-based table.

- Corrected the compatibility table to Dawn’s current enum numbering, which includes scalar 8/16-bit vertex formats before the packed variants.


## Animation frame fallback — 2026-08-30

- Added a native-first RAF scheduler that uses `GpuWindow.onFrame()` when exposed by Electrobun.
- Added an idle-aware, drift-corrected 60 Hz timer fallback for unsupported native/compositor APIs.
- RAF callbacks are coalesced per frame, cancellable, and pending timers stop when idle.


## Ubuntu 24 scope — 2026-08-30

- The RAF scheduler is now GTK-ready and reports `gtk` when Electrobun exposes `GpuWindow.onFrame()`.
- Ubuntu 26 and Windows 11 remain future validation targets; no platform-specific native code was added for them.
- Electrobun 2.0.1 currently exposes no GTK frame callback, so Ubuntu 24 uses the documented timer fallback until the native API is available upstream.


## Assets texture test — 2026-08-30

- Added a local `assets/test-texture.png` and configured Electrobun to copy it into the packaged app.
- Implemented Skia-backed `createImage()` so Pixi `Assets.load()` can decode the native image.
- Demo Sprite now renders the loaded texture instead of `Texture.WHITE`.

- Added the minimal `video.canPlayType()` DOM response required by Pixi Assets loader detection; no video/WebView fallback is enabled.

- Resolved bundled asset URLs from `import.meta.url` so Pixi does not resolve `file:///assets/...` against the host filesystem root.

- Converted the bundled `file://` URL to a filesystem path for Skia Image decoding, matching skia-canvas v3 native loader behavior.

- Replaced `assets/test-texture.png` with a generated Chuck Norris portrait texture for Sprite/Assets validation.


## Pixi Assets file URL fix — 2026-08-30

- Updated the Skia-backed `createImage()` adapter to normalize local `file://` URLs with `fileURLToPath()` before decoding.
- Pixi’s standard `Assets.load()` loader remains unchanged and continues to own caching, retries, and parsing.

- Added a Skia-backed `getContext("2d")` on native images so the existing RGBA texture upload path can consume `Assets.load()` results.


## Sprite visibility — 2026-08-30

- Removed the demo tint and increased the loaded Chuck Norris texture Sprite to 220×220 so the image is visually unmistakable during native smoke tests.


## Skia Sprite upload fix — 2026-08-30

- Wrapped Electrobun’s existing `copyExternalImageToTexture()` so Skia-backed images use the verified RGBA `writeTexture()` path.
- Non-Skia sources continue using the native copy implementation.

- Set the loaded Sprite above demo Graphics with an explicit z-index to make texture visibility unambiguous.


## Canvas texture bridge — 2026-08-30

- Kept Pixi `Assets.load()` as the standard file loader, then rasterize its Skia image into `ElectrobunTextCanvas` before creating the Sprite texture.
- This avoids Electrobun’s native Image copy path while preserving the existing RGBA Canvas upload fallback.

- Registered the native canvas wrapper as `HTMLCanvasElement` for Pixi’s standard `Texture.from()` source detection.


## Sprite batch control — 2026-08-30

- Added a visible green `Texture.WHITE` control Sprite to distinguish Pixi Sprite batch failures from image texture upload failures.


## CanvasSource dimensions fix — 2026-08-30

- Fixed Canvas texture uploads receiving Pixi’s `CanvasSource` wrapper: the fallback now reads `resource`, dimensions, and 2D pixels from the wrapped native canvas instead of uploading a transparent 1×1 texture.

- Fixed CanvasSource uploads that reported a 1×1 copy size: native resource dimensions now take precedence, preserving the full 128×128 Sprite image.


## Switchable native tests — 2026-08-30

- Split the demo into independent Graphics, Sprite, and Text test scenes.
- Added native `GpuWindow` key handling: `1`, `2`, `3` select a test and Space advances to the next one.
- Each switch recreates the selected scene from its initial state and animates only the active test.


## Linux keycode compatibility — 2026-08-30

- Extended test switching to accept both ASCII/GDK keyvals and common X11 hardware keycodes for `1`, `2`, `3`, and Space.
- Added a one-time key event diagnostic to confirm the native payload on Ubuntu.


## Separated visual tests — 2026-08-30

- Moved Graphics, Sprite, and Text test scenes into `src/demo/test/`.
- Expanded the Text test with multiple sizes, fills, thin outlines, and an unoutlined comparison.
- Reduced outline widths to keep Skia-rasterized text readable.


## FFmpeg decoder foundation — 2026-08-30

- Added `NativeVideoDecoder` with an FFmpeg subprocess RGBA frame stream, dimensions, timestamps, pause/play, and close lifecycle.
- FFmpeg is not installed in the current environment, so video playback wiring remains opt-in until a local test video and FFmpeg runtime are available.


## ffmpeg-static dependency — 2026-08-30

- Added `ffmpeg-static@5.3.0` as a pnpm dependency for platform-specific Linux/Windows/macOS FFmpeg binaries.
- `NativeVideoDecoder` now discovers the packaged binary automatically while retaining an explicit `ffmpegPath` override.
- The package is GPL-3.0-or-later; bundled FFmpeg license files remain alongside the binary.


## Video demo test — 2026-08-30

- Added the local Big Buck Bunny 720p/10s sample under `assets/` and copied it into Electrobun bundles.
- Added test 4, which decodes FFmpeg RGBA frames into a Skia canvas and refreshes a Pixi Sprite texture.
- Space cycles through Graphics, Sprite, Text, and Video; key `4` selects the video test directly.
- Bundled the platform FFmpeg executable alongside the app; the decoder prefers it and falls back to the package/system binary.
- Video playback is software-decoded and silent; pause/seek/audio and Windows 11/Ubuntu 26 validation remain future work.
