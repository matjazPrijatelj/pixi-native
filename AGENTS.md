# Repository Guidelines

## Project structure

This repository is a TypeScript proof of concept for rendering PixiJS 8 directly to a native SDL/Dawn WebGPU surface from Node.js. Keep native integration under `src/pixi-node/`, demo scenes under `src/demo/`, startup in `src/main.ts`,.

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
