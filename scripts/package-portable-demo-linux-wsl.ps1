[CmdletBinding()]
param(
    [string]$WslDistribution = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$nodeVersion = "24.15.0"
$nodeArchive = "node-v$nodeVersion-linux-x64.tar.xz"
$nodeArchiveSha256 = "472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$temporaryDirectory = Join-Path $repositoryRoot ".tmp"
$wslArguments = @()
if ($WslDistribution) {
    $wslArguments = @("--distribution", $WslDistribution)
}

$repositoryPathMatch = [regex]::Match($repositoryRoot, "^([A-Za-z]):\\(.*)$")
if (-not $repositoryPathMatch.Success) {
    throw "The repository must be on a Windows drive mounted under /mnt in WSL."
}
$driveLetter = $repositoryPathMatch.Groups[1].Value.ToLowerInvariant()
$relativeRepositoryPath = $repositoryPathMatch.Groups[2].Value.Replace("\", "/")
$wslRepositoryRoot = "/mnt/$driveLetter/$relativeRepositoryPath"
$linuxNodeParent = "$wslRepositoryRoot/.tmp/portable-node-linux"
$linuxNodeRoot = "$linuxNodeParent/node-v$nodeVersion-linux-x64"
$commandFileName = "portable-demo-$([Guid]::NewGuid().ToString("N")).sh"
$windowsCommandPath = Join-Path $temporaryDirectory $commandFileName
$wslCommandPath = "$wslRepositoryRoot/.tmp/$commandFileName"

New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
$command = @"
set -eu
node_root='$linuxNodeRoot'
node_parent='$linuxNodeParent'
node_archive='$nodeArchive'
if [ ! -x "`$node_root/bin/node" ]; then
    mkdir -p "`$node_parent"
    curl -fsSL 'https://nodejs.org/dist/v$nodeVersion/$nodeArchive' -o "/tmp/`$node_archive"
    echo '$nodeArchiveSha256  /tmp/$nodeArchive' | sha256sum -c -
    tar -xJf "/tmp/`$node_archive" -C "`$node_parent"
    rm -f "/tmp/`$node_archive"
fi
cd '$wslRepositoryRoot'
PATH="`$node_root/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    "`$node_root/bin/node" scripts/package-portable-demo.mjs \
    --platform=linux --node-root="`$node_root"
"@
$normalizedCommand = $command.Replace("`r`n", "`n").Replace("`r", "`n")
if (-not $normalizedCommand.EndsWith("`n")) {
    $normalizedCommand += "`n"
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($windowsCommandPath, $normalizedCommand, $utf8WithoutBom)

try {
    & wsl.exe @wslArguments --exec bash $wslCommandPath
    if ($LASTEXITCODE -ne 0) {
        throw "Linux portable demo packaging failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item -LiteralPath $windowsCommandPath -Force -ErrorAction SilentlyContinue
}
