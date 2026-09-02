# Project FFmpeg dependency

The Windows video and audio paths use the FFmpeg build pinned in
`dependency.json`. `pnpm install` downloads it into `.cache/ffmpeg`, verifies
its byte length and SHA-256, and native packaging copies the required runtime
files beside `native_video.node`. A machine-wide FFmpeg installation is not a
build requirement.

The selected build is dynamically linked and licensed under LGPL 3.0 or
later. Do not replace it with a GPL or nonfree build: linking that build into
the native addon changes the distribution obligations for the application.

## Rebuild the Windows x64 artifact manually

Use WSL2 or Linux with Bash, Git, and Docker. The commits below are also stored
in `dependency.json`; the manifest is the source of truth when this document
and the dependency are upgraded.

```bash
git clone https://github.com/BtbN/FFmpeg-Builds.git
cd FFmpeg-Builds
git checkout --detach 8267213e26c1031621e6e1210fe3aa4867214f6a
```

The upstream recipe normally clones the head of `release/8.1`. For a repeatable
project build, edit the generated commands in `build.sh` immediately after
`cd ffmpeg` and add this checkout:

```bash
git checkout --detach 1a748fe2cd43e3ead22fafb1b5b7d77f153898a8
```

Then build the pinned Windows LGPL shared variant:

```bash
./makeimage.sh win64 lgpl-shared 8.1
./build.sh win64 lgpl-shared 8.1
```

The ZIP is written under `artifacts/`. It must contain `bin`, `include`, and
`lib`; the `lib` directory must include MSVC-compatible `avcodec.lib`,
`avformat.lib`, and `avutil.lib` import libraries. Preserve `LICENSE.txt`.

## Validate and publish a rebuild

Run these checks before changing the project manifest:

```bash
unzip -q artifacts/ffmpeg-*.zip -d verify
verify/ffmpeg-*/bin/ffmpeg.exe -version
verify/ffmpeg-*/bin/ffmpeg.exe -hwaccels
sha256sum artifacts/ffmpeg-*.zip
wc -c artifacts/ffmpeg-*.zip
```

The version output must identify FFmpeg 8, list `d3d11va`, contain
`--enable-shared`, and must not contain `--enable-gpl` or `--enable-nonfree`.
Test `pnpm native:video:build` from a normal MSVC environment before publishing.

Publish the ZIP as an immutable GitHub Release asset. Update its URL, SHA-256,
byte length, version, source commit, and recipe commit together in
`dependency.json`. Finally run `pnpm ffmpeg:ensure` with an empty project cache,
load `native_video.node` without a system FFmpeg on `PATH`, and retain the
FFmpeg license alongside the distributed DLLs.

The source and recipe commits make the binary behavior reproducible. ZIP hashes
from a manual rebuild can still differ because compiler and archive timestamps
are embedded by the upstream recipe; the published SHA-256 remains the exact
distribution identity.
