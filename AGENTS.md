# Repository Guidelines

## Project Structure & Module Organization

This repository is an experimental TypeScript proof of concept for rendering PixiJS 8 directly to an Electrobun native WGPU surface. The repository currently contains the design brief in `README.md`; add implementation under `src/` as it is developed. Keep the native integration isolated in `src/pixi-electrobun/` (for example, `ElectrobunCanvas.ts`, `ElectrobunDOMAdapter.ts`, and `createPixiRenderer.ts`). Put demo-only scene code in `src/demo/` and application startup in `src/main.ts`. Root configuration belongs in `package.json`, `tsconfig.json`, and `electrobun.config.ts`. Store small demo assets in a clearly named `assets/` directory.

## Build, Test, and Development Commands

Use Bun 1.4.x with pnpm 9.15.9. Once the package manifest is added, expose conventional scripts and run them through pnpm:

- `pnpm install` installs exact dependency versions, including `pixi.js@8.20.0`.
- `pnpm dev` launches the native GPU-window development build.
- `pnpm build` creates the Electrobun bundle with `bundleWGPU: true`.
- `pnpm test` runs the automated test suite when one is introduced.
- `pnpm typecheck` checks TypeScript without emitting files.

Keep `package.json` scripts authoritative if commands change.

## Coding Style & Naming Conventions

Use TypeScript, four-space indentation, semicolons, and explicit types at native/Pixi boundaries. Name classes and types in `PascalCase`, functions and variables in `camelCase`, and constants in `UPPER_SNAKE_CASE`. Match filenames to exported classes. Prefer Pixi and Electrobun extension points over global browser shims; document any unavoidable shim inline. Keep adapters minimal and reusable, with no WebView, WebGL fallback, or unrelated UI framework.

## Testing Guidelines

No test framework or coverage threshold is configured yet. Add focused unit tests for compatibility adapters and smoke tests for startup and resizing. Name tests `*.test.ts` beside the module or under `tests/`. Manually verify the README success criteria: native Dawn device reuse, WebGPU renderer selection, Sprite, Graphics, normal Text, ticker animation, resize, and stable presentation. A WebGL fallback is a test failure.

## Commit & Pull Request Guidelines

History currently has only `first commit`, so no established convention exists. Use short, imperative subjects such as `Add native WGPU clear stage`, and keep commits aligned with the README’s incremental stages. Pull requests should state the milestone, commands run, platform/GPU tested, and known limitations. Include screenshots or logs for rendering changes and explicitly confirm that no WebView or WebGL fallback was used.
