# Create Pixi Native

Create a minimal TypeScript application for PixiJS 7 or 8 on Pixi Native.

```sh
pnpm dlx @matjazprijatelj/create-pixi-native my-display --pixi 8 --backend webgpu
cd my-display
pnpm install
pnpm dev
```

The generator supports PixiJS 8 with WebGPU or WebGL. PixiJS 7 uses WebGL.
Run the command in a terminal to answer any omitted options interactively.

The generated project uses Node.js 24 watch mode during development, TypeScript
for production output, and Prettier for formatting. The generator writes no
credentials and does not install dependencies.

PixiJS 8 projects depend on `pixi.js@^8.20.0`. PixiJS 7 projects depend only on
the `pixi.js-v7` alias for `pixi.js@^7.4.3`. Both target Pixi Native runtime
`0.1.1`; the generator has its own `0.1.0` release version.

GitHub Packages requires `GITHUB_PACKAGES_TOKEN` with `read:packages` before
running the generator or installing the generated project.
