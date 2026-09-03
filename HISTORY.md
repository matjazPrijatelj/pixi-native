# Development history

- Fixed WebGL demo reload so only a non-repeating `Ctrl+R` press restarts the
  runner, including native `R` key casing and modifier state.

- Kept the dynamically growing Sprite test on Pixi's direct display list so
  each +10 batch becomes visible immediately instead of waiting for a later
  render-group rebuild.

- Fixed native WebGL `bufferSubData` uploads to preserve Pixi source offsets
  and lengths, and to pass compact typed-array copies, preventing dynamic
  Sprite batch geometry corruption.

- Routed WebGL dynamic batch updates through full `bufferData` uploads because
  the native partial-upload path corrupts shared Sprite and BitmapText buffers.

- Added WebGL2 native video rendering with direct NV12 Y/UV uploads and a
  BT.709 GLSL conversion shader, while retaining the existing WebGPU path.

- Enabled the WebGL OpenGL ES 3 path without injecting a duplicate `GL_ES`
  shader macro; the native ES context now owns that definition.

- Split renderer startup into explicit `src/pixi-webgpu` and `src/pixi-webgl`
  entrypoints. Added `pnpm dev:webgpu` and `pnpm dev:webgl`, removed renderer
  selection from `.env`, and exposed the `pixi-native`, `/webgpu`, `/webgl`,
  `/audio`, and `/video` package exports. PixiJS is now a peer dependency with
  a local development version so consumers can update Pixi without bundling a
  second copy.
- Added shared renderer options for title, initial size, resizability, and
  vsync so the public factories are reusable outside the demo.
- Made the development demo explicitly interactive through separate
  `pnpm dev:webgpu` and `pnpm dev:webgl` commands, with backend validation and
  the existing keyboard scene navigation retained.
- Renamed shared runtime code to `src/pixi-native`, demo scene sources to
  `src/demo/scenes`, and demo tests to `src/demo/tests`; removed the empty
  legacy `src/pixi-node` directory and updated native package metadata.
- Split renderer implementations into dedicated WebGPU and WebGL create
  modules; the shared renderer file now only dispatches to the selected backend.
- Corrected dependency ownership: `@node-3d/core` is now a required runtime
  dependency for the public WebGL renderer, its transitive native packages are
  no longer duplicated at the root, and demo-only `gsap` is a dev dependency.
- Moved the demo entrypoint to `src/demo/main.ts`, updated the development
  runner and demo asset paths, and removed the unused `src/debug.ts` helper.
- Moved all demo assets to `src/demo/assets` and updated scene, test, generator,
  and documentation paths.

- Replaced the broken `@kmamal/gl` WebGL path with `@node-3d/glfw@7.3.1` and
  `@node-3d/webgl@6.0.1`. GLFW now owns the OpenGL window/context and swap,
  while the WebGL addon supplies WebGL2 VAO, instancing, and UBO APIs. Added a
  small event/resize adapter and desktop-GL shader compatibility define.
  Verified `pnpm install`, `pnpm typecheck`, and `PIXI_RENDERER=webgl pnpm dev`
  reaches the running Pixi WebGL renderer. Added native-image conversion for
  NodeCanvas uploads so Sprite, Text, and BitmapText atlases use the same
  WebGL texture path. Added `@node-3d/image` for WebGL asset loading, fixed
  the `texSubImage2D` argument position that could corrupt native calls, and
  made `document.createElement('canvas')` return the active native canvas.
  Added pixel extraction to that GL canvas so dynamically generated BitmapFont
  atlases cannot cross the native boundary as an unsupported JS object.
  Switched Canvas2D atlas uploads to `@node-3d/image.Image.fromPixels()` and
  adopted the core desktop-GL shader normalizer; WebGL startup now survives
  the first BitmapText render without NVIDIA driver access violations.
- Corrected Pixi's WebGL version detection by exposing the real native
  `WebGLRenderingContext` constructor. The WebGL2 context is no longer
  misclassified as WebGL1, which was corrupting Sprite and text batch paths.
  `pnpm typecheck` passes and `PIXI_RENDERER=webgl pnpm dev` now remains alive
  past startup and the first rendered frame without the previous crash.

- Diagnosed the `@kmamal/gl` install failure on Node.js 24: release `9.1.0`
  has no Node ABI 134/137 prebuilt for this environment, so its installer
  falls back to `node-gyp` and requires a runnable Python executable. Kept GL
  optional so missing Python does not block the default WebGPU installation;
  configure `PYTHON`/`npm_config_python` before rebuilding GL from source.
- Documented `PIXI_RENDERER=webgpu|webgl` in `.env.example` and the local `.env`,
  with WebGPU as the default.
- Fixed Pixi WebGL capability detection to use the real `@kmamal/gl` context
  instead of the Canvas2D/WebGPU compatibility stub.
- Enabled the stencil buffer on the `@kmamal/gl` context required by Pixi's
  WebGL capability check and masking pipeline.

- Added an explicit root WebGPU stencil-attachment check after renderer setup
  and resize, including the expected `depth24plus-stencil8` format.

- Put the animated video `Graphics` stencil mask in the scene graph while
  keeping `includeInBuild` disabled for the normal color pass, so Pixi can
  update its transform and collect it reliably for masking.

- Added an opt-in animated Graphics mask to the video test, toggled with `M`.

- Added a global bounded PixiJS ParticleContainer test on scene 9, with Tab toggling and scene-aware enable/disable lifecycle.

## 2026-09-02

- Restored Dawn AsyncRunner polling through `setTimeout(..., 33)` for testing instead of unbounded `setImmediate` scheduling.
- Restored the missing `webgpu_sdl.h` header in the split Dawn surface patch so clean Windows builds can configure `dawn_sdl`.
- Rain Sprite scena se začne s štirimi kapljicami, uporablja en ponovno uporaben ticker adapter in po dolgem frame-u ne izvaja catch-up landing zanke.
- Made Rain Sprite mute mode skip Howl creation and native audio preload until audio is explicitly enabled.
- Made Rain Sprite audio muted by default with an M toggle for controlled freeze diagnosis.
- Added Rain Sprite scene `8` with animated falling raindrops, UP +2/DOWN -2 controls, and a generated landing sound for every completed fall.
- Added SDL-to-DOM-like keyboard event dispatch with key, code, modifier, and repeat data while preserving existing scene navigation and audio shortcuts.
- Added SDL-to-DOM-like mouse input dispatch for Pixi, including native canvas listeners, global pointer lifecycle delivery, and clickable drum pads in the Audio test scene.
- Kept Dawn's AsyncRunner on setImmediate and limited the event-scheduler patch to an idle-task early exit, removing the broad 100 ms delay from all WebGPU async operations.
- Split the Dawn customization into four ordered patches for the window surface adapter, D3D12 frame-latency wait, Node renderer surface, and Node event scheduler; updated the Dawn bootstrap to apply each patch separately and verified reverse-apply checks plus TypeScript.
- Moved the Windows modal move/resize frame hook out of the Dawn Node binding into a separate native window addon with per-window state, preserving synchronous 16 ms modal rendering and A/V state callbacks.
- Removed the modal callback surface from the Dawn renderer binding and added `pnpm native:window:build`; verified the refactor with `pnpm typecheck`, native builds, and a Windows move/resize smoke test.
- Retried D3D11VA/VA-API decoding up to five times before CPU fallback, with interruptible 500 ms delays and first-frame success as the hardware acceptance boundary.
- Added a five-second live-video presentation watchdog so an unplugged UDP/SDP camera whose FFmpeg process remains alive is restarted and can recover independently after reconnection.
- Documented the staged Windows zero CPU-copy video architecture, strict zero-copy conditions, production acceptance criteria, and delivery estimate in `NEXT.md`.

## 2026-09-01

- Enabled looping for every local video demo and expanded the Graphics test to nine independently animated primitives, including five new ellipse, triangle, star, ring, and Bezier shapes.
- Fixed demanding Windows 4K A/V synchronization by prebuffering the first video frame before starting the native audio clock, replacing FFmpeg wall-clock input pacing with a bounded decoder queue, and adding in-place stale-frame catch-up without audio or decoder restarts.
- Added a pre-scale 30 fps ceiling for UHD 4:2:2/4:4:4 sources that D3D11VA cannot decode efficiently; the 4K 59.94 fps `water_netflix` acceptance run held A/V between roughly -10 ms and +17 ms with zero decoder drops and zero audio underruns.
- Added a monotonic media clock for files without an audio track so bounded decoding stays at the requested playback rate; the 10-second 720p Big Buck Bunny regression no longer finishes in roughly two seconds.
- Fixed long-running Windows video audio crackling and decoder frame drops by removing the shared voice/stream mutexes and per-frame producer wakeups from the WASAPI callback; the callback now owns the mixer, consumes bounded lock-free PCM blocks, and publishes atomic clocks for video synchronization.
- Added real queue/underrun diagnostics and a 15-second Windows video-audio regression: the repaired stream advanced 15.03 seconds in 15.02 seconds with roughly two seconds queued and zero underruns, versus 13.68 seconds and 64,910 missing frames before the fix; a combined native A/V run completed with zero decoder drops.
- Replaced the Windows x64 JS/worker/SDL audio pump with a packaged napi-rs WASAPI engine using CPAL, native FFmpeg decode threads, a bounded streaming buffer, overlapping-voice mixing, sample-clock fades/loops, and synchronous audible playback clocks; Linux retains the existing SDL worker backend.
- Added ordered native audio event batching through a bounded thread-safe callback so blocked JavaScript delays Howler listeners without stopping playback or duplicating `fade`/`end`, plus explicit missing-addon diagnostics and `pnpm native:audio:build` packaging under `native/audio/dist/win32-x64`.
- Kept video audio and its decoder alive through Win32 modal move/resize, retaining audio as the master clock and presenting the latest due frame without an A/V restart or seek when the modal loop ends.
- Added native mixer, loop, fade, streaming backpressure/underrun, teardown, credential-redaction, JS-blocking clock/event-order, binding-preflight, and modal video lifecycle regressions.
- Verified TypeScript, all 69 Node tests, eleven native audio Rust tests, Clippy with warnings denied, the release addon build, and Windows WASAPI tests for blocked JS plus sustained video-audio playback.
- Fixed shutdown and restart bind-group warnings by releasing WebGPU bind groups before destroying Pixi stage-owned texture sources.
- Fixed Windows native configure/build to use Dawn's pinned `ninja.exe` directly, avoiding `CMAKE_MAKE_PROGRAM is not set` after a successful `gclient sync`.
- Made `pnpm native:build` discover Visual Studio 2022 through `vswhere.exe` and import the x64 MSVC/Windows SDK environment automatically when launched from a normal PowerShell or terminal.
- Made native checkout cleanup retry transient Windows locks and fail explicitly instead of reusing a partially removed Dawn repository with an existing `origin` remote.
- Added structured FFmpeg input/video-output/audio-output arguments, source-paced live decoding, authenticated-URL redaction, media fragments, ffprobe metadata, file playback rates with pitch-preserving audio, and live reconnect backoff.
- Added EventTarget-compatible native-video readiness/playback/seek/end/error events, standard loop behavior, and Windows modal-state handling that runs video silently during drag-resize before restarting A/V at the latest presented timestamp.
- Added scene 7 with two simultaneous configurable low-latency HTTP/SDP/RTP streams loaded from an ignored local `.env`, plus missing-config diagnostics and per-camera decode/reconnect status.
- Added RTP configuration, media-source, event ordering, loop, playback-rate, modal resync, reconnect, FFmpeg argument-order, credential-redaction, and seventh-scene navigation regressions.
- Replaced the native video's single latest-frame slot with a bounded four-frame chronological NV12 queue, preserving latest-frame delivery for silent playback while allowing audio-clock playback to consume ordered frames.
- Fixed low video upload FPS and continuously rising decoder drops by draining all audio-due frames per render, retaining only the first future frame, and exposing queue depth, scheduler skips, and A/V offset diagnostics.
- Added native queue overflow/order tests and TypeScript regressions for multi-frame audio scheduling and no-audio latest-frame behavior without changing the Windows Dawn/vsync path.
- Verified TypeScript, all 56 Node tests, six Rust tests, Clippy with warnings denied, the Windows release addon API, and a five-second 1080p D3D11VA smoke test with 91 decoded/presented and zero dropped or skipped frames.
- Routed the Windows modal move/resize timer through the shared RAF scheduler so every pending consumer, including GSAP, video clocks, Pixi ticker work, and rendering, continues while the title bar owns the event loop.
- Reconfigured the existing Dawn surface from the live Win32 client area during drag-resize, with configured-state and re-entry guards that avoid repeated surface destruction, double unconfigure, and `Surface is not configured` crashes.
- Added fail-fast detection for stale Windows Dawn addons, safe N-API callback scopes and teardown, and regression tests for timer/DXGI modal dispatch without duplicate RAF callbacks.
- Made the pinned Windows native build reproducible by disabling depot_tools self-update, restoring its expected Git shim, applying Dawn patches with recounted hunks, and invoking the CMake-selected Ninja executable directly.
- Restored the Sprite stress-test default to the documented ten-sprite batch, corrected its dynamic-child assertion, and stopped the GSAP ticker during test teardown so the suite exits without leaked RAF handles.
- Verified TypeScript, all 54 Node tests, a complete MSVC/Dawn native build, binary modal-callback presence, and a Windows Pixi WebGPU/D3D12 startup on the DXGI 60 Hz signal.
- Fixed Linux local image loading by converting `file://` URLs to filesystem paths before passing them to `@napi-rs/canvas`, restoring bitmap-font atlas startup and adding regression coverage.
- Added a transparent illustrated drum-kit texture and a synthesized eight-sound MP3 audio atlas with normalized hit regions for future pointer input; scene `6` maps U/I/O/P/J/K/L/Č to the kit and flashes each struck component.
- Made repeated per-voice fades latest-wins from the actual mixer volume, suppressed stale delayed fade events with generation tokens, and moved fade timing to a monotonic voice clock so it remains correct across music-loop boundaries.
- Added MP3 atlas, texture-alpha, key-map, eight-voice overlap, repeated-fade, and loop-boundary regression coverage.

## 2026-08-31

- Added a native Howler-compatible audio layer over SDL playback with a worker-thread stereo 48 kHz mixer, overlapping voices, audio sprites, pause/stop/seek, looping, per-sound/global volume and mute, fades, events, preload, and explicit cache/worker/device teardown.
- Added bounded FFmpeg PCM streaming for `html5` sounds and embedded video audio, retained decoded caching for short effects/music sprites, and made audio the master clock that holds early NV12 frames while video-only or audio-failure playback falls back safely.
- Added Audio scene `6`, a deterministic generated stereo WAV sprite fixture, BitmapText audio diagnostics, video audio status, and audio/A-V lifecycle tests.
- Added a GSAP-powered Sprite stress test: Up creates ten independently randomized, continuously animated sprites, Down removes the latest ten, and scene disposal or resize kills and rebuilds timelines without retaining removed Pixi objects.
- Added generated transparent 512×512 bat-hero and 256×256 platform-mascot PNG assets, retained the original texture, and moved the live Sprite count to the shared BitmapText metrics atlas.
- Verified TypeScript, all 46 Node tests, asset dimensions/transparency, tween cleanup, and a Windows WebGPU/D3D12 runtime interaction with three +10 batches followed by one -10 batch on the DXGI-paced RAF path.
- Replaced Windows timer-paced RAF with the D3D12/DXGI frame-latency waitable-object signal, configured the FIFO swapchain for a maximum frame latency of one, and retained refresh-rate timer fallback when the native signal is unavailable.
- Verified TypeScript, all 43 Node tests, the complete native Dawn build, and a Windows D3D12 runtime launch reporting `DXGI frame-latency signal` at the detected 60 Hz refresh rate.
- Replaced the frequently updated FPS/frame-time/jitter overlay and native-video status/statistics label with shared-atlas BitmapText, avoiding repeated Canvas text rasterization and texture uploads when metrics change.
- Added a dedicated BitmapText demo scene on key `4`, moved native video to key `5`, and exercised runtime-generated and external BMFont atlases with animated, tinted, multiline, and Slovenian-character samples.
- Added a deterministic procedural 5x7 BMFont generator and checked-in `.fnt`/PNG fixture, plus direct absolute-path and `file:` loading in the Node DOM adapter without an HTTP server.
- Added BitmapText parser, asset-loading, shared-font lifecycle, local-fetch, timing-hook, and five-scene navigation tests; all 41 Node tests and TypeScript pass.
- Verified the BitmapText scene on the real Pixi WebGPU/D3D12 renderer and ordered application, font-cache, and native-device teardown after queued GPU work completes.
- Fixed Text/Video scene-switch resource retention by replacing remove-only transitions with recursive scene disposal, explicitly closing video decoders, destroying owned mesh buffers, and fully cleaning the active scene during restart and shutdown.
- Added bounded reusable RGBA-to-BGRA staging buffers for native Canvas/Text uploads while preserving externally owned Sprite textures during scene disposal.
- Verified 36 Node tests, TypeScript, Rust tests and Clippy, the native-video release build, and D3D12 resource cleanup: Text registrations return to zero and video managed textures return from three to the single renderer baseline after disposal.
- Smoothed native animation pacing by matching RAF deadlines to the SDL display refresh rate, rejecting early Node timer callbacks, enabling WebGPU MSAA, and retaining missed-frame skipping without catch-up bursts.
- Preserved each demo video's real 24/30/59.94/60 fps instead of forcing all FFmpeg output to 24 fps, corrected upload-FPS measurement, and reused superseded native NV12 buffers to reduce decoder allocation pressure.
- Verified the optimized path with 32 Node tests, TypeScript, Rust tests and Clippy, a D3D12/FIFO runtime launch at the detected 60 Hz refresh rate, and a 60 fps D3D11VA decode smoke test with 104 decoded, 102 presented, and 2 dropped frames.
- Replaced per-frame CPU RGBA conversion and upload with packed NV12 delivery, zero-copy N-API Y/UV views, `r8unorm`/`rg8unorm` textures, and a Pixi WebGPU Mesh shader for BT.709 limited-range conversion.
- Added `NativeVideo` and `NativeVideoSprite` with play, pause/resume, writable `currentTime` seek, latest-frame-wins delivery, backend/error state, and decoded/presented/dropped frame statistics.
- Enabled the native video path on Windows/D3D11VA and Linux/VA-API with CPU fallback, plus app-relative bundled FFmpeg lookup after explicit and environment overrides.
- Added strict native Dawn bind-group index normalization for Pixi custom shaders and NV12 layout, zero-copy, color, FFmpeg resolution, and media lifecycle tests.
- Verified a Windows WebGPU/D3D12 ticker smoke test using D3D11VA: 49 decoded, 47 presented, and 1 dropped frame with 1,382,400 bytes per 1280×720 frame.
- Verified TypeScript, all 30 Node tests, four Rust native-video tests, Clippy with warnings denied, and the Windows native-video release build.
- Corrected native Canvas texture uploads by converting RGBA pixels to Pixi's BGRA texture layout and honoring premultiplied alpha, removing the blue tint from the Sprite demo.
- Renamed the general Skia Canvas2D adapter from `NodeTextCanvas` to `NodeCanvas` and updated its exports, consumers, tests, and documentation.
- Configured the Sprite texture as `rgba8unorm` and added a direct premultiplied-RGBA upload path backed by `@napi-rs/canvas.data()`.
- Optimized remaining RGBA-to-BGRA uploads with a 32-bit channel swap while preserving the fallback alpha conversion.
- Made native GPU canvas event-listener compatibility hooks silent because SDL owns input dispatch.
- Avoided Pixi's global texture-pool release during process shutdown and restart, eliminating stale BindGroup texture-source warnings.
- Corrected the timer-backed animation-frame scheduler so a delayed callback skips missed slots instead of producing an immediate catch-up frame and visible motion stutter.
- Added compatibility tests for texture channel conversion, alpha handling, missed-frame pacing, and animation-frame cancellation.
- Verified `pnpm typecheck` and the affected adapter, animation, and compatibility tests; the full suite passes 23 of 24 tests, with the pre-existing `platform.test.ts` still importing the removed `supportsNativeVideo` export.
- Replaced `skia-canvas` with the prebuilt `@napi-rs/canvas` Canvas2D backend while preserving the project-owned native Dawn GPU addon.
- Verified `@napi-rs/canvas` text pixels and local PNG rasterization, all 22 tests, TypeScript, and a stable PixiJS WebGPU/D3D12 demo launch.
- Added Windows 11 x64 support for the core PixiJS demo with D3D12 as the platform default while preserving Linux/Vulkan and the `WGPU_BACKEND` override.
- Isolated native Dawn binaries by platform and architecture so a Windows build does not overwrite the checked-in Linux x64 addon.
- Added a non-destructive Windows native-build preflight, explicit Dawn Windows surface/D3D12 configuration, and Windows-safe build command execution.
- Limited the Windows demo to Graphics, Sprite, and normal Text; the native FFmpeg VA-API video scene remains Linux-only.
- Documented the Windows prerequisites and Developer PowerShell workflow.
- Scoped Dawn/depot_tools downloads to Git's verified OpenSSL backend on Windows after reproducing `schannel: SEC_E_NO_CREDENTIALS` from the system Git configuration.
- Routed Windows `gclient.bat` and `ninja.bat` through `cmd.exe` after confirming that direct `execFileSync` batch execution fails with `EINVAL`.
- Added a Node TLS bootstrap for the pinned Windows CIPD client with mandatory depot_tools SHA-256 verification, avoiding the same Schannel failure in PowerShell `Invoke-WebRequest`.
- Corrected the malformed `Module.cpp` hunk counts in `dawn.patch`, which Git rejected as a corrupt patch before compilation.
- Added the Dawn SDL target's missing source include path and packaged the matching Windows SDK `d3dcompiler_47.dll` beside `dawn.node` for D3D12 runtime shader compilation.
- Verified the complete Windows native build with MSVC 19.43, Windows SDK 10.0.28000.0, and Node.js 24.15.0; `pnpm dev` selected PixiJS WebGPU/D3D12 on an NVIDIA Quadro P1000 and presented stably at 1280x720.
- Re-ran `pnpm typecheck` and all 21 tests successfully after the Windows runtime fixes.

## 2026-08-30

- Migrated the PixiJS 8 proof of concept to Node.js 24 LTS.
- Added the project-owned Dawn Node addon with @kmamal/sdl and shared adapter/device path.
- Added Skia Canvas2D integration for normal Pixi Text.
- Removed the experimental video path from the first milestone.
- Added Node canvas adapter tests and native adapter tests.
- Added optional PixiJS WebGL rendering through `@kmamal/gl` and SDL OpenGL windows; WebGPU remains the default and native video remains WebGPU-only. The GL package is optional because its Node 24 native build requires Python/node-gyp.
- Fixed WebGL dynamic BitmapText atlases by keeping the internal Canvas2D
  surface dimensions synchronized when Pixi resizes a NodeGLCanvas resource.
- Fixed WebGL Sprite assets by flipping native image rows before uploading them
  through the shared RGBA Canvas2D path.
- Isolated each demo scene in its own render group so WebGL batches and
  instruction sets remain valid after scene changes.
- Normalized native WebGL image uploads for external FNT BitmapText atlases,
  preventing animated bitmap text from being vertically mirrored.
- Accepted browser-style WebGL arrow-key names in scene navigation so the
  arrow controls work consistently across WebGL and WebGPU.
