#!/usr/bin/env bash
set -euo pipefail

export MSYSTEM=UCRT64
export CHERE_INVOKING=1
export MSYS2_PATH_TYPE=inherit
export PATH="/ucrt64/bin:/usr/bin:${PATH}"

source_dir="$(cygpath -u "$1")"
build_dir="$(cygpath -u "$2")"
install_dir="$(cygpath -u "$3")"
options_file="$(cygpath -u "$4")"

mapfile -t configure_options < "${options_file}"
cd "${build_dir}"
export SOURCE_DATE_EPOCH="$(git -C "${source_dir}" show -s --format=%ct HEAD)"
"${source_dir}/configure" \
    "--prefix=${install_dir}" \
    "${configure_options[@]}"

jobs="${NUMBER_OF_PROCESSORS:-1}"
make -j"${jobs}"
make install
strip "${install_dir}/bin/ffmpeg.exe" "${install_dir}/bin/ffprobe.exe"
