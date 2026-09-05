# Third-party notices

`pixi-native` is an internally distributed, unlicensed package. That status
does not replace or restrict the licenses of the third-party components below.

## Dawn and Tint

The packaged `dawn.node` binaries contain Dawn and Tint code.

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

The pinned Dawn source contains additional third-party notices in its upstream
`LICENSE` file: <https://dawn.googlesource.com/dawn/+/HEAD/LICENSE>.

## Rust native-addon dependencies

The native window, audio, and video binaries include code from napi-rs and,
where applicable, CPAL, crossbeam, and windows-rs. Their exact versions are
recorded in the checked-in Cargo lockfiles and remain governed by their
respective upstream licenses.

## Microsoft D3DCompiler

The Windows package contains `d3dcompiler_47.dll` from the Windows SDK. Its
redistribution remains subject to the Microsoft Software License Terms for the
Windows SDK used to build the binary.

## webgl-node, native-gles, and ANGLE

The Windows WebGL runtime installs `webgl-node` and `native-gles` as npm
dependencies. Both packages are MIT-licensed. `native-gles` supplies prebuilt
ANGLE/EGL binaries; ANGLE is BSD-licensed and includes third-party components
governed by the notices in its upstream source distribution:
<https://chromium.googlesource.com/angle/angle/+/HEAD/README.md#license>.

## FFmpeg

The Windows x64 distribution contains a project-built, statically linked
FFmpeg runtime as separate `ffmpeg.exe` and `ffprobe.exe` programs invoked
through subprocess pipes:

- Source: <https://github.com/FFmpeg/FFmpeg/commit/140fd653ae>
- License profile: GNU Lesser General Public License version 2.1 or later
- Configuration: decode-only minimal Windows x64 build without GPL or nonfree components

The packaged `FFMPEG_LICENSE.txt` contains the complete LGPL 2.1 text and
`FFMPEG_BUILD_INFO.txt` records the source, compiler, linkage, and configure
options. Each release places the complete pinned corresponding-source archive
and its SHA-256 file beside the npm tarball. The LGPL terms apply to the bundled
FFmpeg programs. H.264 and H.265 may have separate patent-licensing obligations
that are not granted by the LGPL. Linux FFmpeg is not currently contained in
this package and must be supplied through `FFMPEG_PATH` or `PATH`.
