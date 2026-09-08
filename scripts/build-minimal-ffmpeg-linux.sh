#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${root_dir}/native/ffmpeg/source"
build_dir="${root_dir}/native/ffmpeg/build/linux-x64"
install_dir="${root_dir}/native/ffmpeg/out/linux-x64"
options_file="${root_dir}/scripts/ffmpeg-linux-configure-options.txt"
native_dist="${root_dir}/native/video/dist/linux-x64"
package_dist="${root_dir}/packages/native-linux-x64/native/video/dist/linux-x64"

if [[ ! -x "${source_dir}/configure" ]]; then
    echo "Missing FFmpeg source checkout at ${source_dir}" >&2
    exit 1
fi

rm -rf "${build_dir}" "${install_dir}"
mkdir -p "${build_dir}" "${install_dir}"
mapfile -t configure_options < "${options_file}"
cd "${build_dir}"
"${source_dir}/configure" "--prefix=${install_dir}" "${configure_options[@]}"
make -j"$(nproc)"
make install

if ! grep -q '^#define CONFIG_H264_VAAPI_HWACCEL 1$' config_components.h; then
    echo "FFmpeg build did not enable H264_VAAPI_HWACCEL" >&2
    exit 1
fi
if ! grep -q '^#define CONFIG_HEVC_VAAPI_HWACCEL 1$' config_components.h; then
    echo "FFmpeg build did not enable HEVC_VAAPI_HWACCEL" >&2
    exit 1
fi

mkdir -p "${native_dist}" "${package_dist}"
cp "${install_dir}/bin/ffmpeg" "${native_dist}/ffmpeg"
cp "${install_dir}/bin/ffprobe" "${native_dist}/ffprobe"
cp "${native_dist}/ffmpeg" "${package_dist}/ffmpeg"
cp "${native_dist}/ffprobe" "${package_dist}/ffprobe"
echo "Built and staged Linux FFmpeg with H.264/HEVC VA-API support."
