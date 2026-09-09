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

GitHub Packages requires `GITHUB_PACKAGES_TOKEN` with `read:packages` before
running the generator or installing the generated project.
