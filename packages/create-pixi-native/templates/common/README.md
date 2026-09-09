# {{PROJECT_NAME}}

Minimal PixiJS {{PIXI_MAJOR}} application running in a native Node.js window with
the {{BACKEND}} renderer.

The centered hero background uses the `{{ANIMATION_ENGINE}}` animation option
selected when this project was generated. It continuously scales from 0.5 to
1.0 and back over a 12-second cycle. Generate another project with
`--animation gsap` to include the optional GSAP implementation, or use
`--animation ticker` to keep the animation on Pixi's application ticker.

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
