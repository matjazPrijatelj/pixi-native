# Third-party notices

Pixi Native uses the MIT License. The third-party components listed below keep
their own license terms.

## JavaScript and native runtime projects

Pixi Native uses these projects through direct packages or native integration:

- [PixiJS](https://pixijs.com/) for the rendering API and scene graph
- [webgl-node](https://github.com/monteslu/webgl-node) and
  [native-gles](https://github.com/monteslu/native-gles) for WebGL2 through EGL
- [SDL](https://www.libsdl.org/) through `@kmamal/sdl` for native windows,
  input, and display information
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) for Canvas2D, text,
  and image decoding
- [napi-rs](https://napi.rs/) for the Rust native addons
- [miniaudio](https://miniaud.io/) through `maudio` for native audio output
- [FFmpeg](https://ffmpeg.org/) for video probing, decoding, and streamed audio

The installed packages and their upstream repositories contain their copyright
and license terms. Those terms continue to apply to each dependency.

## Dawn and Tint

The packaged `pixi_native_gpu.node` binaries contain Dawn and Tint code.

Copyright 2017-2026 The Dawn & Tint Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

The pinned Dawn source contains more third-party notices in its upstream
[LICENSE file](https://dawn.googlesource.com/dawn/+/HEAD/LICENSE).

## Rust native-addon dependencies

The native window, audio, and video binaries include napi-rs and, where used,
miniaudio, `maudio`, and windows-rs. The checked-in Cargo lockfiles record their
exact versions. Each crate remains subject to its upstream license.

## Microsoft D3DCompiler

The Windows package contains `d3dcompiler_47.dll` from the Windows SDK.
Microsoft Software License Terms for the Windows SDK used to build the binary
govern its redistribution.

## FFmpeg

The Windows x64 and Linux x64 native packages contain project-built, statically
linked FFmpeg and FFprobe programs. Pixi Native invokes them through subprocess
pipes.

- Source: <https://github.com/FFmpeg/FFmpeg/commit/140fd653aed8cad774f991ba083e2d01e86420c7>
- Release: FFmpeg 8.0
- License profile: GNU Lesser General Public License version 2.1 or later
- Configuration: decode-focused x64 builds without GPL or nonfree components

Each native package includes `FFMPEG_LICENSE.txt`, `FFMPEG_BUILD_INFO.txt`,
and `FFMPEG_SHA256SUMS` beside its FFmpeg programs. Each release places the
complete pinned corresponding-source archive and its SHA-256 file under
`third_party/`. The LGPL terms apply to the bundled FFmpeg programs. H.264 and H.265
may require separate patent licenses that the LGPL does not grant.
