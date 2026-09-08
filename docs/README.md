# Pixi Native developer documentation

Pixi Native runs PixiJS directly in a native Node.js process without a browser,
WebView, or CEF. Applications choose one version package per display process:
`@pixi-native/pixi7` or `@pixi-native/pixi8`.

## Guides

- [Getting started](getting-started.md) — install the packages and open a native
  Pixi window.
- [Application and API](application-and-api.md) — application lifecycle,
  renderer ownership, window options, and public entrypoints.
- [Media and files](media-and-files.md) — module-relative files, native video,
  packed alpha, and native audio.
- [GSAP integration](integrations/gsap.md) — optional GSAP and PixiPlugin setup,
  modal-frame ticking, and cleanup.
- [Deployment](deployment.md) — shared launcher installation, separate display
  processes, platform packages, and private tarballs.

The TypeScript declarations shipped with each package are the authoritative API
reference. These guides document the supported public entrypoints and lifecycle;
paths below `dist/` and unexported source paths are internal.
