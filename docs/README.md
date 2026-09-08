# Pixi Native documentation

Pixi Native runs PixiJS 7 or 8 in a native Node.js process. These guides cover
the supported package entrypoints, application lifecycle, media, and release
layout.

## Start here

- [Getting started](getting-started.md) explains platform package selection and
  opens a native Pixi window.
- [Application lifecycle and API](application-and-api.md) covers `createApp()`,
  manual renderer ownership, window options, and public entrypoints.
- [Media and files](media-and-files.md) covers packaged assets, native video,
  packed alpha, and audio.
- [GSAP integration](integrations/gsap.md) configures optional GSAP and keeps its
  ticker moving during Windows move and resize loops.
- [Deployment](deployment.md) describes release archives, platform packages,
  and a shared launcher installation.

Use `@pixi-native/pixi7` or `@pixi-native/pixi8` as the main import for a
display. Each process must load one Pixi major. The launcher may install both
facades because it starts displays as separate Node.js processes.

The TypeScript declarations shipped with each package define the public API.
Paths below `dist/` and unexported repository source paths have no compatibility
guarantee.

## Release status

Version 0.1.0 is a pre-release and remains `UNLICENSED`. The documentation
describes the current packages, but an open-source publication still requires a
chosen license and matching package metadata.

Return to the [project README](../README.md) or open the
[canonical docs directory](https://github.com/matjazPrijatelj/pixi-native/tree/main/docs).
