param(
    [string]$WslDistribution = ""
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslArguments = @()
if ($WslDistribution) {
    $wslArguments = @("--distribution", $WslDistribution)
}

Write-Host "Building Linux x64 native audio and video bindings in WSL..."
& wsl.exe @wslArguments --cd $repositoryRoot --exec bash -lc `
    "set -e; if command -v node >/dev/null 2>&1; then NODE=node; elif [ -x .tmp/linux-node/node-v24.15.0-linux-x64/bin/node ]; then NODE=.tmp/linux-node/node-v24.15.0-linux-x64/bin/node; else echo 'Linux Node.js 24 was not found in PATH or .tmp/linux-node.' >&2; exit 1; fi; `$NODE native/audio/scripts/build.mjs; `$NODE native/video/scripts/build.mjs"
if ($LASTEXITCODE -ne 0) {
    throw "WSL native media build failed with exit code $LASTEXITCODE."
}

Write-Host "Linux x64 native audio and video bindings are ready."
