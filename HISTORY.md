# Development history

## 2026-09-01

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
