# {{PROJECT_NAME}}

Minimal PixiJS {{PIXI_MAJOR}} application running in a native Node.js window with
the {{BACKEND}} renderer.

## Setup

Use Node.js 24 and pnpm 9. Export a GitHub classic personal access token with
`read:packages` before installing dependencies:

```powershell
$env:GITHUB_PACKAGES_TOKEN = "your-token"
pnpm install
pnpm dev
```

Node watch mode restarts the application after a source change. Build and run
the compiled application with:

```sh
pnpm build
pnpm start
```

Format or check the project with `pnpm format` and `pnpm format:check`.
