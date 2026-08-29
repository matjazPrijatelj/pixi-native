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
