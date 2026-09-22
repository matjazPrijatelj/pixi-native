#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${root_dir}/native/ffmpeg/source"
build_dir="${root_dir}/native/ffmpeg/build/linux-x64-shared"
install_dir="${root_dir}/native/ffmpeg/out/linux-x64-shared"

if [[ ! -x "${source_dir}/configure" ]]; then
    echo "Missing FFmpeg source checkout at ${source_dir}" >&2
    exit 1
fi

required_packages=()
if ! command -v nasm >/dev/null 2>&1; then
    required_packages+=(nasm)
fi
if ! command -v pkg-config >/dev/null 2>&1; then
    required_packages+=(pkg-config)
fi
if ! pkg-config --exists libva 2>/dev/null; then
    required_packages+=(libva-dev)
fi
if ! ldconfig -p 2>/dev/null | grep -q 'libclang\.so'; then
    required_packages+=(libclang-dev)
fi

if ((${#required_packages[@]} > 0)); then
    echo "Installing WSL build prerequisites: ${required_packages[*]}"
    if [[ "$(id -u)" -eq 0 ]]; then
        apt-get update
        apt-get install -y "${required_packages[@]}"
    elif command -v sudo >/dev/null 2>&1; then
        sudo apt-get update
        sudo apt-get install -y "${required_packages[@]}"
    else
        echo "Missing WSL packages: ${required_packages[*]}. Install them as root, then retry." >&2
        exit 1
    fi
fi

rm -rf "${build_dir}" "${install_dir}"
mkdir -p "${build_dir}" "${install_dir}"
cd "${build_dir}"

"${source_dir}/configure" \
    "--prefix=${install_dir}" \
    --target-os=linux \
    --cc=gcc \
    --cxx=g++ \
    --arch=x86_64 \
    --disable-autodetect \
    --disable-debug \
    --disable-doc \
    --disable-static \
    --enable-shared \
    --enable-pic \
    --disable-gpl \
    --disable-nonfree \
    --disable-version3 \
    --disable-everything \
    --enable-vaapi \
    --enable-hwaccel=h264_vaapi \
    --enable-hwaccel=hevc_vaapi \
    --enable-small \
    --enable-ffmpeg \
    --enable-ffprobe \
    --enable-avcodec \
    --enable-avdevice \
    --enable-avformat \
    --enable-avfilter \
    --enable-avutil \
    --enable-swresample \
    --enable-swscale \
    --enable-network \
    --enable-decoder=h264,hevc,aac,mp3,pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
    --enable-parser=h264,hevc,aac,mpegaudio \
    --enable-demuxer=mov,mpegts,h264,hevc,aac,mp3,wav,sdp,rtp \
    --enable-protocol=file,pipe,http,https,tls,tcp,udp,rtp \
    --enable-filter=fps,scale,format,hwdownload,atempo,aresample,aformat \
    --enable-encoder=rawvideo,pcm_f32le \
    --enable-muxer=rawvideo,pcm_f32le,null \
    --extra-cflags=-Os \
    --extra-ldflags='-Wl,-rpath,$ORIGIN'

make -j"$(nproc)"
make install

for required_path in \
    "${install_dir}/include/libavcodec/avcodec.h" \
    "${install_dir}/lib/pkgconfig/libavcodec.pc" \
    "${install_dir}/lib/pkgconfig/libavformat.pc"; do
    if [[ ! -f "${required_path}" ]]; then
        echo "Native FFmpeg SDK build is incomplete: ${required_path}" >&2
        exit 1
    fi
done

echo "Built Linux x64 shared FFmpeg SDK at ${install_dir}."
