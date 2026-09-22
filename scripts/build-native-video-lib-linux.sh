#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root_dir}"

if command -v node >/dev/null 2>&1; then
    node_bin=node
elif [[ -x .tmp/linux-node/node-v24.15.0-linux-x64/bin/node ]]; then
    node_bin=.tmp/linux-node/node-v24.15.0-linux-x64/bin/node
else
    echo "Linux Node.js 24 was not found in PATH or .tmp/linux-node." >&2
    exit 1
fi

bash scripts/build-native-ffmpeg-sdk-linux.sh
PIXI_NATIVE_VIDEO_NATIVE_FFMPEG=1 "${node_bin}" native/video/scripts/build.mjs
