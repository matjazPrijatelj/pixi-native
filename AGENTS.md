# Repository Guidelines

## Project structure

This repository is a TypeScript native runtime for rendering PixiJS 8 directly to a native SDL/Dawn WebGPU or WebGL surface from Node.js. Keep shared native integration under `src/pixi-native/`, renderer entrypoints under `src/pixi-native/webgpu/` and `src/pixi-native/webgl/`, PixiJS 7 demo startup/scenes under `src/demo/v7/`, PixiJS 8 demo startup/scenes under `src/demo/v8/`, shared assets under `src/demo/assets/`, tests under `tests/`, and the development runner in `src/dev-runner.ts`.

## Commands

Use Node.js 24 LTS and pnpm 9.15.9:

- `pnpm install` installs dependencies and prebuilt native binaries.
- `pnpm dev` launches the native GPU window.
- `pnpm typecheck` checks TypeScript.
- `pnpm test` runs tests.

## Style

Use TypeScript, four-space indentation, semicolons, explicit types at native/GPU boundaries, PascalCase classes/types, camelCase functions/variables, and UPPER_SNAKE_CASE constants. Avoid browser globals and WebGL fallback.

## Testing

Test compatibility adapters and native startup/resizing. A successful demo must show Sprite, Graphics, normal Text, ticker animation, stable presentation, and WebGPU-only renderer selection.

## Progress

Write all tasks progress to HISTORY.md

## Extra

Name long regexes and place comments on functions that are harder to read, understand, or maintain.
Code should be readable prefer for/for-of in (tight loops) over forEach when possible.

Before every `native:build`, warn Matjaz and wait for explicit confirmation because the build is long-running and he runs it manually.
Never start a competing `native:build` while his manual build is active.
