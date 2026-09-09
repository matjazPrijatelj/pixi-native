# Pixi Native documentation

Pixi Native runs PixiJS 7 or 8 in a native Node.js process. These guides cover
the supported package entrypoints, application lifecycle, media, and release
layout.

## Start here

- [Getting started](getting-started.md) explains platform package selection and
  opens a native Pixi window.
- [Application lifecycle and API](application-and-api.md) covers `createApp()`,
  manual renderer ownership, window options, and public entrypoints.
- [API reference](api-reference.md) documents Pixi Native classes, methods,
  options, events, ownership, and error behavior.
- [Media and files](media-and-files.md) covers packaged assets, native video,
  packed alpha, and audio.
- [GSAP integration](integrations/gsap.md) configures optional GSAP and keeps its
  ticker moving during Windows move and resize loops.
- [Deployment](deployment.md) describes release archives, platform packages,
  and a shared launcher installation.

Use `@matjash/pixi-native/pixi7` or the package root for PixiJS 8 as
the main import. Each process must load one Pixi major. A launcher may use both
facades when it starts displays as separate Node.js processes.

The TypeScript declarations shipped with each package define the public API.
Paths below `dist/` and unexported repository source paths have no compatibility
guarantee.

## Release status

Version 0.1.2 is a pre-release under the MIT License.

Return to the [project README](../README.md). The package archive includes this
documentation because the GitHub repository may require access.
