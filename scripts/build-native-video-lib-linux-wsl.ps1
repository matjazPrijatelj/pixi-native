param(
    [string]$WslDistribution = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslArguments = @()
if ($WslDistribution) {
    $wslArguments = @("--distribution", $WslDistribution)
}

Write-Host "Building Linux x64 shared FFmpeg SDK and in-process native video binding in WSL..."
& wsl.exe @wslArguments --cd $repositoryRoot --exec bash scripts/build-native-video-lib-linux.sh
if ($LASTEXITCODE -ne 0) {
    throw "WSL native libavcodec video build failed with exit code $LASTEXITCODE."
}

Write-Host "Linux x64 in-process libavcodec video binding and its FFmpeg runtime libraries are ready."
