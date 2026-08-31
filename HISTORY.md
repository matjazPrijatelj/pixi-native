# Development history

## 2026-08-31

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
