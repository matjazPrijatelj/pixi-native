# Development history

## 2026-09-11

- Replaced `@kmamal/sdl` with a focused SDL3 napi-rs window addon for Windows
  and Linux. SDL3 now owns transparent windows, input events, native WebGPU
  surface handles, OpenGL ES contexts, and buffer swaps; `native-gles` remains
  only as the established WebGL2 OpenGL ES call table. Native packages now
  stage the SDL3 shared runtime alongside the addon.
- Fixed initial and resized Dawn surfaces reading the removed private SDL2
  `_pixelWidth`/`_pixelHeight` fields. The WebGPU bridge now validates and uses
  the SDL3 window's public pixel dimensions instead of silently configuring a
  1-by-1 presentation texture.
- Restored effective WebGL and WebGL7 antialiasing on SDL/EGL by rendering the
  screen through a shared multisample framebuffer and resolving it before each
  buffer swap, including supported-sample fallback, resize, diagnostics, and
  cleanup.
- Fixed vertically mirrored PixiJS 7 Sprite, Text, and BitmapText content on
  the SDL WebGL surface. Pixi 7 now uses the shared image upload adapter once:
  normalized Canvas pixels retain their row order while raw native image data
  receives the single required Y-row reversal.
- Replaced the GLFW-owned PixiJS 7 and 8 WebGL windows with SDL-owned windows
  presented through `webgl-node`/`native-gles`. WebGPU remains on SDL, so all
  renderers now share the SDL window/input lifecycle while native miniaudio
  handles audio independently on Windows and Linux x64.
- Removed the `@node-3d/core` and `@node-3d/glfw` runtime dependencies and their
  GLFW-specific surface, window adapter, transparency code, and tests. Restored
  native RGBA image upload adaptation for the EGL WebGL2 path and updated
  package metadata, notices, and backend documentation.

## 2026-09-10

- Replaced the native CPAL audio output path with a process-level miniaudio
  engine (`maudio` 0.1.14) for Windows and Linux x64. FFmpeg remains the
  decoder; static voices use miniaudio buffers and streaming voices use bounded
  PCM ring buffers. Added Linux audio addon staging and retained the existing
  N-API Howler-compatible contract.
- Prepared the Win32 WebGPU fix for an independent npm patch release: runtime
  and Win32 packages advance to `0.1.3`, Linux remains on `0.1.2`, internal
  package links accept compatible `~0.1.x` patches, and the `0.1.5` generator
  creates projects against `@matjash/pixi-native@~0.1.3`. Added a guarded
  Win32-only publisher so this release does not require republishing Linux.
- Fixed a native WebGPU surface-texture reference leak that retained one Dawn
  object per rendered frame. A 60-minute, 500-sprite D3D12 soak grew private
  memory by 224 MiB while GPU memory, handles, and threads stayed stable. The
  renderer now transfers the surface-owned texture reference directly into
  Dawn's RAII wrappers, releases temporary textures used to create views, and
  reports failed surface-acquisition statuses explicitly.
- Rebuilt the Win32 x64 addon from a clean CMake cache and verified matching
  distribution hashes, native-module loading, TypeScript, and focused tests.
  In a post-fix 500-sprite D3D12 soak, private memory grew about 31 MiB across
  the final 50 warm minutes instead of the previous 224 MiB in 60 minutes;
  post-GC JavaScript heap and handle counts remained stable.

## 2026-09-09

- Removed redundant JavaScript and declaration outputs from `packages/core/src`;
  TypeScript is now the single source and package builds emit both formats to
  `dist`. Added public API JSDoc and a consumer reference for application,
  files, audio, video, runtime, and canvas APIs. The public audio engine view is
  now limited to read-only diagnostics while playback remains owned by
  `Howl`/`Howler`.
- Prepared the first public npm release under the `@matjash` scope. Runtime
  packages now use lockstep version `0.1.2`, `create-pixi-native` uses `0.1.4`,
  generated projects install without registry credentials, and the guarded
  publisher targets npmjs with interactive 2FA and post-publish digest checks.
- Fixed generated development startup for PixiJS 8 WebGPU, PixiJS 8 WebGL,
  and PixiJS 7 WebGL in `create-pixi-native` 0.1.3. Source templates now import
  `backgroundAnimation.ts` for direct Node.js 24 execution, while TypeScript
  rewrites the production import to `.js` during compilation.
- Removed low-value demo navigation, particle, RTP, asset-shape, documentation,
  and duplicated integration tests. Kept the critical native lifecycle,
  renderer adapter, resize/animation, media state-machine, public API,
  generator, packaging, and release regression coverage.
- Removed the incompatible generated `pixi-native.png` placeholder from
  `create-pixi-native` 0.1.2. Generated PixiJS 7 and 8 projects now load only
  the packaged `pixi-hero.png`, with regression coverage through the same
  `@node-3d/image` decoder used by the WebGL renderer. Added the complete
  generator pack, tag, push, preflight, publish, and consumer-verification
  runbook to the deployment documentation.
- Fixed generated binary assets being decoded and rewritten as UTF-8 during
  template token replacement. `create-pixi-native` 0.1.1 now preserves the
  hero PNG byte-for-byte so PixiJS 8 WebGL can load it through
  `@node-3d/image` on Windows and Linux.
- Added the hero artwork as the generated `create-pixi-native` background with
  a centered 0.5-to-1.0 yoyo scale animation. The new
  `--animation <ticker|gsap>` option defaults to the dependency-free Pixi
  ticker and can generate an optional GSAP example with native modal-frame
  ticking and managed cleanup for PixiJS 7 or 8.
- Made the Windows-to-WSL release helper execute multiline Bash commands from
  temporary UTF-8/LF script files. This prevents Windows PowerShell argument
  handling from opening the default interactive WSL shell during Linux
  packaging.
- Added the Pixi Native hero artwork to the main documentation and packaged
  facade. PixiJS 7 and 8 demos now use the supplied demo copy as a dimmed,
  cover-scaled background that follows native window resizing.
- Split PixiJS from the published facade's runtime dependencies into optional
  peers (`pixi.js@^8.20.0` and the `pixi.js-v7` alias for `^7.4.3`). Generated
  projects now install only their selected Pixi major. The development workspace
  and private facades retain exact tested Pixi versions.
- Gave `@matjazprijatelj/create-pixi-native` its independent `0.1.0` version,
  archive, release manifest, publisher preflight, and
  `create-pixi-native-v0.1.0` tag while runtime/native packages remain lockstep
  at `0.1.1` under the existing runtime release flow.
- Added `@matjazprijatelj/create-pixi-native`, a PixiJS 7/8 TypeScript project
  generator with WebGPU/WebGL selection, Node.js watch reloads, production
  TypeScript builds, Prettier commands, and a small Sprite/Graphics/Text smoke
  application. Its packaging does not invoke a native build.
- Fixed the Windows GitHub Packages publisher to invoke npm through Node's
  `npm-cli.js` instead of spawning the `npm.cmd` shim. Publisher subprocesses
  now use the Windows system CA store and report their actual spawn, TLS, or
  registry error instead of an unhelpful null exit code.
- Prepared the 0.1.0 GitHub Packages release under the MIT License. The public
  API now ships as `@matjazprijatelj/pixi-native`, with PixiJS 8 at the package
  root and explicit `/pixi8`, `/pixi7`, and `/core` subpaths.
- Added Windows and Linux x64 optional native packages, facade tarball staging,
  platform release manifests, FFmpeg corresponding source inside each native
  archive, and a guarded local GitHub Packages publisher. The publisher checks
  the release tag, source fingerprint, checksums, metadata, authentication, and
  immutable registry digests before uploading.
- Reworked the public README and packaged guides for the 0.1.0 pre-release with
  package contents, Windows/Linux support matrices, registry and tarball setup,
  copyable PixiJS 7/8 examples, API ownership, media limits, deployment, and a
  canonical documentation link.
- Added dependency acknowledgements, updated the third-party notices for the
  project-owned GPU addon and both bundled FFmpeg targets, and applied the MIT
  license to the repository and all publication manifests.
- Verified the Linux x64 build, native addon loading, FFmpeg runtime, and full
  headless test suite in an isolated WSL checkout. The fresh production install
  downloads Linux dependencies, loads the packaged addons, and exercises the
  packaged FFmpeg programs. Both hosts produce the same facade archive.
- Added a repeatable Windows-to-WSL release helper that provisions pinned
  Node.js 24 tooling, transfers the current source and existing Linux native
  artifacts, runs the Linux package checks, and returns the archive and
  manifest without starting a native build. The source-switch clock test now
  derives its bound from elapsed time so a loaded clean install remains
  deterministic.
- Fixed the Windows distribution audio regression by using the tracked
  120-second AAC fixture for the 15-second streaming test. Audio play waits now
  report native and FFmpeg `playerror` details instead of timing out.
- Made Windows package staging preserve hydrated native addons when ignored
  build output contains a Git LFS pointer, and moved FFmpeg A/V smoke checks to
  the tracked fixture that contains an AAC stream.

## 2026-09-08

- Kept all demo MP4 files available locally while removing the large movie
  assets from Git tracking; PixiJS 7/8 video tests continue cycling every
  available asset, with only `Big_Buck_Bunny_720_10s_20MB.mp4` and
  `Sync_Check-720p30fps.mp4` versioned.

- Made distribution packing platform-specific: Linux x64 now packages and
  fresh-tests `@pixi-native/native-linux-x64` with Linux FFmpeg binaries,
  while Windows continues to package its Windows native target. Release
  tarballs and checksums remain tracked in Git until npm publication.

- Added LFS-pointer detection for PixiJS 7/8 demo video assets so missing
  Git LFS downloads are skipped with a clear `git lfs pull` instruction instead
  of starting repeated FFmpeg decoder retries.

- Blocked accidental root `pnpm pack` invocations with a clear redirect to
  `pnpm run pack:dist`, keeping the private development workspace out of
  distributable archives.
- Made Pixi 7 and Pixi 8 initialize their native asset environment as part of
  `createRenderer`/`createApp`, allowing standard `Assets.load` calls without
  application-owned `Assets.init` or native texture conversion helpers.
- Removed accidentally committed JavaScript and declaration outputs from
  `packages/core/src`; package compilation continues to emit them only into
  `packages/core/dist`.
- Made GSAP a development-only dependency used by demos and tests; published
  packages remain GSAP-free. Added English developer guides for setup, public
  lifecycle and entrypoints, media/files, optional GSAP plus PixiPlugin wiring,
  and shared-launcher deployment. Packaging now includes and verifies those
  guides, and production-consumer tests prove GSAP is not installed transitively.
- Added a Linux WebGPU surface capability fallback: when Wayland/Vulkan does
  not expose premultiplied alpha, the native renderer now selects opaque mode,
  reports the actual alpha mode, and keeps the Intel Linux demo running.

- Registered the Linux x64 native package in the shared resolver so bundled
  FFmpeg is available to SDL audio and video-audio playback. Linux Wayland
  windows now keep their SDL-owned premultiplied alpha path without passing a
  Wayland handle to the Windows-only transparency addon, and SDL playback
  startup errors are exposed for diagnostics.

- Split the distribution into `@pixi-native/pixi7`, `@pixi-native/pixi8`,
  `@pixi-native/core`, and `@pixi-native/native-win32-x64` workspace packages.
  Each version package exposes its matching Pixi API with compact `createApp`,
  `createRenderer`, and `VideoSprite` names while both share one neutral runtime
  and one platform-native package in the launcher's `node_modules`.
- Replaced repository-relative native addon and FFmpeg lookup with a validated
  platform-package resolver. Distribution packing now produces and fresh-tests
  four checksummed tarballs together, leaving a future Linux package independent
  from the Pixi major packages.

## 2026-09-07

- Added deliberate `pixi-native/runtime` and `pixi-native/canvas` public barrels,
  package targets, packed-file validation, runtime import smoke coverage, and
  declaration checks. Removed the incomplete `pixi-native/application` export
  because no matching public barrel exists.
- Reorganized `src/pixi-native` by ownership into `application`, `canvas`,
  `renderers`, and `runtime` while preserving the existing `/v7`, `/v8`,
  `/audio`, `/video`, and `/files` package entrypoints. Updated internal, demo,
  and test imports and corrected the deeper WebGPU renderer path to the native
  GPU addon.
- Kept distribution builds in the full development checkout while making the
  packed-install proof production-first: runtime imports and FFmpeg checks now
  run after `pnpm install --prod`, and TypeScript is added only afterward for
  declaration validation. A repository-local npm cache makes packing independent
  of the user's npm cache permissions. Documented the `pnpm-workspace.yaml`
  Windows x64 optional-native dependency target and Linux x64 opt-in. The fresh
  package fixture explicitly ignores the parent workspace so pnpm installs it as
  an independent consumer project.
- Routed PixiJS 8 and PixiJS 7 WebGL through one shared
  `@node-3d/core`/`@node-3d/glfw` OpenGL ES surface on Windows and Linux,
  explicitly requesting an 8-bit transparent framebuffer and allowing Linux
  compositors to report support at startup. Removed the superseded
  `webgl-node`/`native-gles` ANGLE path, package dependencies, distribution
  checks, and notices after fresh Windows validation of both demos. Graphics,
  Sprite/GSAP, normal video, packed-alpha video, transparency, drag, and
  continuous resize were visually confirmed; type checking, all 137 retained
  tests, the frozen lockfile, and the package build pass.
- Kept PixiJS 7/8 animation and video frame work queued during the blocking
  Windows move/resize loop by moving GLFW event polling to its own rearming
  animation-frame callback. The callback rearms before entering GLFW and
  rejects a nested poll while the native modal timer continues dispatching
  Pixi frames. Added focused scheduling, reentrancy, and teardown coverage;
  validation passes without rebuilding the native addon, and modal animation
  and video continuity were manually confirmed in both WebGL demos.
- Restored the GSAP modal-frame bridge removed by the shared application
  initializer migration. Both demos now advance the independent GSAP ticker
  from native modal frames and remove the listener during managed teardown;
  focused regression coverage verifies ticking, cleanup, and the unsupported
  no-op path. Both Sprite scenes were manually confirmed during drag and
  continuous resize.
- Kept SpriteTest GSAP timelines alive across continuous resize events in both
  PixiJS versions. Animations now tween normalized layout state that is mapped
  into the current window bounds, so resize updates positions without killing
  or restarting timeline progress. Added PixiJS 7/8 regression coverage for
  timeline identity, post-resize advancement, bounds, and teardown; static and
  dynamically added sprites were manually confirmed in both demos.
- Expanded WebGPU, PixiJS 8 WebGL, and PixiJS 7 WebGL startup diagnostics
  with resolved window configuration and actual desktop position.
- Moved the demo test suite and its HEVC fixture from `src/demo/tests` to the
  repository-level `tests` directory.
- Fixed video-only playback running too quickly during Windows window dragging
  and resizing. Modal rendering now starts the monotonic file clock as soon as
  the decoder has a frame, without resetting it when asynchronous prebuffering
  completes.

## 2026-09-06

- Added right-side packed-alpha NV12 rendering to the public PixiJS 7 and 8
  `VideoSprite` APIs. The GPU shaders sample the left color image and right
  grayscale mask without an RGBA conversion, clamp both regions at texel
  centers, and render the bundled 1280+640 fixture in video scene 5 with `T`.
- Added a PixiJS 7/8 source-event mode to video scene 5. It changes `src` on a
  single active `NativeVideo`, validates the replacement playback event order,
  displays recent events and PASS/FAIL state, logs every media event to the
  console, and supports manual or five-second automatic source cycling.
- Replaced the mixed unversioned renderer exports with explicit
  `pixi-native/v7` and `pixi-native/v8` facades. Both expose the matching Pixi
  API through compact `createApp`, `createRenderer`, and `VideoSprite` names;
  the former root, WebGPU, WebGL, and WebGL7 package paths are intentionally
  removed. PixiJS 7 is now an internal dependency, and its adapter no longer
  loads PixiJS 8 while installing the native environment.
- Allowed distribution packaging to proceed while the replacement Linux GPU
  addon is pending. The package excludes the incompatible legacy `dawn.node`,
  keeps Linux WebGL/video support, and reports Linux WebGPU as unsupported when
  its project-owned `pixi_native_gpu.node` binding is absent.
- Made `NativeVideo.src` perform a complete source reset: active playback now
  continues on the replacement source, stale metadata cannot overwrite the new
  state, and existing Pixi 7/8 `VideoSprite` instances clear the previous frame
  before presenting frames from the new decoder.
- Replaced the patched Dawn Node module with the project-owned
  `pixi_native_gpu.node` addon. It links Dawn's native and Node interop targets
  but atomically owns `Instance`, `Adapter`, `Device`, and surface creation, so
  renderer presentation no longer unwraps Dawn's private `GPUDevice::device_`.
  CMake injects the addon once through Dawn's project include, resolves its
  links against Dawn's targets during generation, and defers only the generated
  N-API symbol dependency; packaging and runtime lookup use the new artifact
  name.
- Removed the Dawn SDL adapter, private Node binding, frame-latency, and event
  scheduler patches. The sole remaining Dawn patch is a clean-base
  DirectComposition change for premultiplied transparent Windows swapchains.
  Windows VSync RAF pacing moved to the native window addon and waits on the
  compositor clock with refresh-rate spacing and timer fallback.
- Static validation passed: the addon source passes MSVC `/Zs`, the retained
  Dawn patch applies to the pinned clean index, `pnpm typecheck`, `cargo check`,
  and 22 focused scheduler/window/platform tests pass. The full test run passed
  118 tests but cannot load three Pixi 7 suites because the current
  `node_modules/pixi.js-v7` package is incomplete.
- Fixed addon injection during Dawn configuration by adding the project target
  once from `CMAKE_PROJECT_INCLUDE` and deferring only its dependency on Dawn's
  generated N-API symbols. A complete Windows `pnpm native:build` then passed
  all 945 Ninja steps and staged a loadable `pixi_native_gpu.node`.
- Rebuilt the native window addon with its compositor-wait export and made the
  navigator adapter reuse the context-owned GPU device during Pixi's WebGPU
  capability probe. A live PixiJS 8 startup selected WebGPU/D3D12, FIFO,
  `bgra8unorm`, and the NVIDIA Quadro P1000 and remained stable during the smoke
  interval; visual FIFO/immediate/transparency comparison remains outstanding.
- Added the lightweight `pixi-native/files` entrypoint for module-relative file
  resolution, existence checks, and asynchronous byte, text, and JSON reads.
  Absolute paths, UNC paths, and file URLs remain unrestricted so displays can
  access files outside the release tree without depending on launcher `cwd`.

## 2026-09-05

- Added optional `maxFps` frame pacing from 24 to 360 FPS for WebGPU,
  WebGL 8, and WebGL 7 when `vsync` is disabled. Without the option, timer
  pacing still follows the display refresh rate; enabled VSync remains owned
  by FIFO/DXGI and warns when `maxFps` would be ignored. Type checking, all
  114 tests, and 240 FPS WebGPU/WebGL 8/WebGL 7 startup and shutdown smoke
  tests pass without a native rebuild.
- Added explicit RAF scheduler and DOM-adapter teardown across WebGPU, WebGL 8,
  and WebGL 7 so pending timers, native present waits, callbacks, and global
  listeners cannot resume after native shutdown. WebGPU now honors the existing
  `vsync` option by selecting FIFO/DXGI pacing when enabled and immediate/timer
  pacing when disabled, without changing the native Dawn or audio layers.
  Type checking, all 112 tests, both WebGPU presentation modes, and clean
  WebGL 8/WebGL 7 startup and shutdown smoke tests pass.
- Restored PixiJS 7 child-specific texture ownership during scene disposal:
  Text now releases its private Canvas Texture/BaseTexture while Sprite and
  BitmapText continue preserving shared asset and font textures.
- Returned disposed PixiJS 8 scene render groups to Pixi's pool so repeated
  scene changes reuse instruction-set batch buffers instead of retaining new
  ArrayBuffer-backed batchers. Added a shared, disabled-by-default four-scene
  loop for PixiJS 8 and PixiJS 7 that can be toggled with `+` for isolated heap
  profiling.
- Routed PixiJS 7 Windows ANGLE image and Canvas uploads through the shared
  premultiplied-RGBA adapter already used by PixiJS 8. Real drum-atlas pixel
  coverage confirms transparent matte colors are removed and translucent
  channels are premultiplied without changing orientation; final Text,
  BitmapText, and sprite appearance remains subject to visual confirmation.
- Changed opaque-window option handling so `backgroundAlpha` below `1` emits a
  warning and normalizes to `1` instead of aborting renderer startup. Invalid
  values outside the `0` to `1` range remain errors.
- Added one managed `createNativePixiApplication()` initializer for PixiJS 8
  WebGPU/WebGL and the same named initializer for PixiJS 7 WebGL. It owns the
  render/present ticker, native polling, pointer/keyboard/wheel forwarding,
  resize delivery, modal-frame RAF advancement, and idempotent close/signal
  teardown while preserving all low-level factories. Migrated both demos to
  the managed lifecycle and added focused lifecycle/input/order tests without
  rebuilding native code.
- Fixed Alt+F4 shutdown for PixiJS 8 WebGL by skipping WebGPU queue draining
  when no GPU device exists. WebGL and PixiJS 7 teardown now also avoid asking
  SDL to destroy a window that its close-event handler already destroyed. Type
  checking, all 99 tests, and the production package build pass.
- Made PixiJS 7 WebGL native teardown tolerate an application already destroyed
  by its owner, preventing a second `ResizePlugin.destroy()` call from invoking
  the cleared `cancelResize` callback when the SDL window closes. Type checking,
  all 99 tests, and the production package build pass.
- Normalized PixiJS 8 WebGPU and WebGL background clears to premultiplied RGB,
  matching PixiJS 7 and making `backgroundAlpha: 0.5` visually represent the
  same half-transparent background on all three renderers. Centralized the
  native background color and added focused conversion coverage. Type checking,
  all 99 tests, and the production package build pass without a native rebuild.
- Added a Canvas2D decode fallback for native `Image` objects in the PixiJS 8
  WebGL texture-upload adapter, covering external PNG bitmap-font atlases that
  do not expose pixels directly. Added a validated shared `backgroundAlpha`
  renderer option and set the transparent demo background across
  WebGPU, PixiJS 8 WebGL, and PixiJS 7 WebGL. Type checking, all 98 tests, the
  focused real-image upload regression, and the production package build pass.
- Replaced the ineffective Windows GLFW/layered-window WebGL transparency
  workaround with the SDL HWND plus `webgl-node`/`native-gles` ANGLE/EGL path,
  shared by PixiJS 8 and PixiJS 7. Added a PixiJS 8 image-upload adapter for
  the browser-style `texImage2D`/`texSubImage2D` overloads so Canvas-backed
  Sprite, AnimatedSprite, Text, and BitmapText textures reach native GLES.
  A fresh PixiJS 8 run visually confirmed all three Sprite textures, GSAP
  animation, and repeatable Text rendering over the transparent desktop at
  about 59 FPS.
- Added ANGLE context ownership, resize, swap, teardown, WebGL globals, Pixi 7
  file-location compatibility, dependency/license metadata, and fresh-package
  assertions for the installed ANGLE runtime. The demo remains decorated by
  default with `borderless: false`.
- Added Windows 11 per-pixel transparency for WebGPU with premultiplied
  Dawn/DXGI composition; the user visually confirmed that path. Initial GLFW
  and layered-window WebGL experiments remained opaque and were superseded by
  the SDL/ANGLE implementation above.
- Added shared WebGPU, WebGL, and PixiJS 7 WebGL support for startup-only
  borderless windows, validated absolute virtual-desktop positioning, and
  programmatic move, minimize, maximize, and restore controls; type checking,
  all 91 repository tests, and the production package build pass.
- Repaired and updated the existing MSYS2 UCRT64 installation, installed the
  required GCC 16.2.0, NASM 2.16.03, and base development toolchain, and built
  the pinned FFmpeg 8.0 source without invoking the Dawn `native:build`.
- Corrected the minimal FFmpeg raw float-audio muxer configuration from the
  runtime name `f32le` to the configure component `pcm_f32le`, and made staging
  reject builds that do not expose both the `rawvideo` and `f32le` muxers.
- Accepted FFmpeg's release-form `n8.0` identity and shell-quoted configure
  values while retaining exact option, pinned-source, LGPL, and static-runtime
  checks; license validation now tolerates FFmpeg's wrapped console text.
- Produced 4,231,680-byte `ffmpeg.exe` and 4,064,768-byte `ffprobe.exe`
  binaries and a compact `pixi-native-0.1.0.tgz` below the enforced 100 MiB
  unpacked-size limit.
- Verified all 90 repository tests, the compiled package, seven native
  artifacts, five FFmpeg distribution files, six fresh-package entrypoints,
  H.264/H.265 and WAV/MP3/AAC decoding, float audio output, and a fresh consumer
  install. The corresponding 16,397,147-byte source archive SHA-256 is
  `083d0987eb7a1827187a6d4c6e5d37d71293a68eaecd7e0a03dccb38cc249b89`.

## 2026-09-04

- Replaced the planned Gyan shared FFmpeg payload with a reproducible minimal
  Windows x64 build pinned to FFmpeg commit `140fd653ae`: static `ffmpeg.exe`
  and `ffprobe.exe`, LGPL-only decoding, D3D11VA, common MP4/RTP video and
  AAC/MP3/PCM audio support, with no bundled FFmpeg DLL closure.
- Added an MSYS2 UCRT64 preflight and build workflow that never installs system
  prerequisites, captures the exact compiler/configuration manifest, stages
  the verified result, and emits a hash-protected corresponding-source archive.
- Added H.265, AAC, MP3/WAV, playback-rate, NV12, local HTTP, static-runtime,
  source-archive, and fresh-package validation for the minimal build.
- Added a verified private distribution pack that emits compiled JavaScript,
  declarations, the exact Windows/Linux x64 native runtime inventory, and a
  SHA-256 checksum without including demos or native build trees.
- Added explicit package platform, engine, dependency, export, and third-party
  notice metadata for the `pixi-native` 0.1.0 tarball.
- Made the Windows modal-frame addon conditional through a shared controller,
  so Linux renderers no longer try to load a Windows-only native binding.
- Repaired the PixiJS 7 video adapter test setup and aligned the RTP config
  regression with the active low-latency probe settings.
- Rasterized PixiJS 7 Assets image resources through NodeCanvas before native
  WebGL upload when the native Image has no raw pixel buffer, preventing stale
  BitmapFont texture contents from appearing in Sprite scenes.
- Destroyed PixiJS 7 scenes recursively during navigation so cached BitmapText
  geometry from a previous scene cannot render over Sprite scenes.
- Initialized the PixiJS 7 Assets loader with native-safe PNG preferences and
  disabled data-URI format detection before direct asset loading.
- Removed PixiJS 7 browser detection plugins from the native startup path,
  because v7 detection still probes compressed-texture GL support when tests
  are skipped.
- Aligned the native global `Image` constructor with PixiJS 7's Assets parser
  and `HTMLImageElement` adapter type so direct PNG loads create valid image
  resources.
- Switched PixiJS 7 demo texture loading to direct `Assets.load` calls,
  matching the PixiJS 8 asset lifecycle without a wrapper loader.
- Fixed PixiJS 7 drum hit-testing by assigning explicit ellipse hit areas;
  transparent zero-alpha Graphics had no usable bounds for mouse interaction.
- Waited for PixiJS 7 demo textures to finish loading before creating scenes,
  keeping drum hit-targets and animated texture frame dimensions aligned with
  their visible assets.
- Matched the PixiJS 7 WebGL native mouse bridge to its selected pointer or
  legacy mouse event mode and supplied the pointer metadata required by the
  interaction system.
- Fixed PixiJS 7 WebGL mouse interaction by attaching the application to the
  same `NodeGLCanvas` that receives native mouse events.
- Replaced the deprecated PixiJS 7 drum-pad `interactive` flag with
  `eventMode = "static"`.
- Added the PixiJS 7 WebGL mouse event bridge for drum-pad clicks and
  aligned its Sprite test with the PixiJS 8 GSAP/static/dynamic animation,
  resize, counting, and cleanup behavior.
- Fixed the PixiJS 7 dynamic BitmapFont character range so the ASCII letters
  used by the BitmapText scene are included alongside the Slovenian glyphs.
- Switched dynamic PixiJS 7 demo titles and diagnostics in Video, RTP video,
  Sprite, Rain, and Audio scenes to the shared BitmapText atlas.
- Added the PixiJS 7 global top-right FPS overlay and aligned scene 9 with the PixiJS 8 bounded particle emitter, including Tab toggling, scene lifecycle, resize, recycling, and shutdown cleanup.
- Replaced the PixiJS 7 scene 4 text samples and frequently updated metric helper with real BitmapText, including dynamic and external bitmap-font atlases matching the PixiJS 8 BitmapText test.
- Fixed PixiJS 7 external BitmapText startup by bypassing unsupported native format detection and registering the FNT descriptor with its PNG atlas directly.

- Removed empty legacy renderer/demo directories after verifying their replacements are active. Normalized comparisons confirmed PixiJS 8 WebGL/WebGPU behavior is unchanged apart from relocation imports and the required native addon path adjustment.
- Fixed PixiJS 7 native video frame uploads by rasterizing converted NV12 pixels into the project `NodeCanvas` before calling `Texture.from`; Pixi 7 does not auto-detect `@node-3d/core` `Image` objects as resources.
- Stabilized the PixiJS 7 video texture lifecycle, centered the video after its frame dimensions are known, and aligned scene `[5]` with the V8 video sources and diagnostics.
- Added lazy PixiJS 7 scene factories so file and RTP video playback starts only after selecting its scene, and replaced the v7 CPU RGBA bridge with persistent Y/UV textures and a BT.709 GLSL shader.
- Normalized SDL/DOM arrow-key names in the PixiJS 7 runner so sprite population and video selection receive the same `up`/`down` commands.
- Corrected PixiJS 8 WebGPU native addon paths after moving the renderer under `src/pixi-native/webgpu`.
- Kept the PixiJS 7 video sprite out of the shared video barrel so PixiJS 8 WebGPU startup does not load the PixiJS 7 package.
- Removed the empty legacy renderer/demo directories and verified the active PixiJS 8 WebGL and WebGPU implementations are unchanged apart from relocation paths.

- Reorganized demos under `src/demo/v8` and `src/demo/v7` while preserving
  shared assets in `src/demo/assets`.
- Corrected PixiJS 7 WebGL source-row handling so Canvas text and image sprites
  use the same non-flipped orientation.
- Prefer PixiJS 7's normalized premultiplied pixel API before the raw native
  image buffer, preventing sprites that expose both APIs from being flipped
  during their initial upload.

- Reorganized native renderer implementations under `src/pixi-native/webgl`
  and `src/pixi-native/webgpu`, and moved the matching PixiJS 7 demo to
  `src/demo/v7` with all nine scene slots and native media/audio integration.

- Added a separate PixiJS 7 WebGL proof-of-concept entrypoint using the shared
  native window, canvas, DOM adapter, resize, swap, and shutdown lifecycle.

- Added an isolated PixiJS 7 demo under `src/demo/v7` with Sprite, Graphics,
  Text, ticker animation, resize, and native WebGL presentation.

- Expanded the PixiJS 7 demo with numbered navigation and separate v7 scene
  implementations for Graphics, Sprite, Text, BitmapText, Rain Sprite, and
  diagnostic video, audio, RTP, and Particle scenes.

- Patched the PixiJS 7 native DOM adapter to support existing incomplete native
  documents required by the accessibility plugin.

- Routed PixiJS 7 offscreen canvas creation through the Canvas2D adapter so
  built-in white textures and Graphics initialize correctly on WebGL.

- Added the stencil capability query required by PixiJS 7 WebGL detection.

- Added PixiJS 7 WebGL texture and dynamic buffer compatibility adapters for
  native image uploads and shared geometry updates.

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

- Split renderer startup into explicit `src/pixi-native/webgpu` and `src/pixi-native/webgl`
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
- Updated the PixiJS 7 WebGL audio scene to match PixiJS 8 with the drum atlas, clickable/key-triggered pads, music sprites, fades, mute, and diagnostics.

## 2026-09-04

- Changed PixiJS 8 WebGL and PixiJS 7 WebGL7 presentation to use direct GLFW buffer swaps, bypassing the GLFW frame gate that suppressed modal RAF frames during window dragging and resizing.
- Routed WebGL modal timer frames directly through the Pixi ticker after application initialization, removing the remaining dependency on a pending RAF callback during native window moves and resizes.
- Added a modal-frame listener for the independent GSAP ticker so Sprite animations advance with Graphics during WebGL window dragging and resizing.
- Connected the native Windows modal-frame controller to PixiJS 8 WebGL and PixiJS 7 WebGL7, keeping RAF-driven animations running while the window is moved or resized.
- Added animated stencil masks to the PixiJS 7 video test and fixed PixiJS 8 mask toggling so the ellipse remains mask-only and is never rendered as a white shape.

## 2026-09-06

- Added a shared 4x MSAA screen framebuffer and resolve step to the Windows ANGLE surface used by PixiJS 7 and PixiJS 8 WebGL, replacing the non-multisampled default framebuffer that left Graphics edges visibly jagged.
- Added the shared `antialiasSamples` option for WebGPU, WebGL8, and WebGL7 with a 4x default, explicit 0x/2x/4x/8x selection, and backend-specific fallback warnings.
- Hardened the Linux FFmpeg CPU fallback by using a software-only NV12 filter
  graph with serial filter initialization, avoiding the bundled FFmpeg
  `auto_scale` negotiation regression after VA-API retries.
- Kept all native `.node` build artifacts versioned in Git and assigned them
  to Git LFS, including platform package copies.
- Updated native video, window, and GPU build scripts to copy fresh binaries
  into the runtime platform packages automatically.
- Fixed the Linux minimal FFmpeg configuration order so `h264_vaapi` and
  `hevc_vaapi` remain enabled after `--disable-everything`.
- Added a reproducible `ffmpeg:build:linux` command that validates both
  hardware acceleration modules before staging the Linux FFmpeg binaries.
- Limited Git LFS tracking to distributable native package `.node` modules;
  source and intermediate native build copies remain local staging output.
- Fixed WebGL bitmap-font PNG loading for GLFW native images by converting
  local `file:` URLs to filesystem paths.
- Fixed PixiJS 7 external bitmap-font loading by passing the atlas as a valid
  `file:` URL to `Texture.from()`.
