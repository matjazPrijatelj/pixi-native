[CmdletBinding()]
param(
    [string]$WslDistribution = "",
    [string]$Checkout = "/tmp/pixi-native-release-check",
    [string]$LinuxLibraryPath = "",
    [switch]$KeepCheckout
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$nodeVersion = "24.15.0"
$nodeArchive = "node-v$nodeVersion-linux-x64.tar.xz"
$nodeArchiveSha256 = "472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$version = (Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json).version
$temporaryDirectory = Join-Path $repositoryRoot ".tmp"
$sourceArchive = Join-Path $temporaryDirectory "linux-release-source.tar"
$facadeArchive = Join-Path $repositoryRoot "artifacts\matjash-pixi-native-$version.tgz"
$ffmpegSourceArchive = Join-Path $repositoryRoot "artifacts\ffmpeg-source-8.0-140fd653ae.tar.gz"
$ffmpegSourceChecksum = "$ffmpegSourceArchive.sha256"
$wslArguments = @()
if ($WslDistribution) {
    $wslArguments = @("--distribution", $WslDistribution)
}

if ($Checkout -notmatch "^/tmp/pixi-native-release-[A-Za-z0-9._-]+$") {
    throw "Checkout must be a dedicated /tmp/pixi-native-release-* path."
}

function ConvertTo-BashLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value.Contains("'")) {
        throw "A WSL path or argument cannot contain a single quote."
    }
    return "'$Value'"
}

function Invoke-WslCommand {
    param([Parameter(Mandatory = $true)][string]$Command)

    $commandFileName = "wsl-command-$([Guid]::NewGuid().ToString("N")).sh"
    $windowsCommandPath = Join-Path $temporaryDirectory $commandFileName
    $wslCommandPath = "$wslRepositoryRoot/.tmp/$commandFileName"
    $normalizedCommand = $Command.Replace("`r`n", "`n").Replace("`r", "`n")
    if (-not $normalizedCommand.EndsWith("`n")) {
        $normalizedCommand += "`n"
    }
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($windowsCommandPath, $normalizedCommand, $utf8WithoutBom)

    $wslExitCode = -1
    try {
        & wsl.exe @wslArguments --exec bash $wslCommandPath
        $wslExitCode = $LASTEXITCODE
    }
    finally {
        Remove-Item -LiteralPath $windowsCommandPath -Force -ErrorAction SilentlyContinue
    }
    if ($wslExitCode -ne 0) {
        throw "WSL command failed with exit code $wslExitCode."
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

foreach ($requiredFile in @(
    $facadeArchive,
    $ffmpegSourceArchive,
    $ffmpegSourceChecksum
)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Missing required release input: $requiredFile"
    }
}

$nodeMajor = (& node -p "process.versions.node.split('.')[0]").Trim()
if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne "24") {
    throw "Run this script with Node.js 24 LTS."
}

$sourceFingerprint = (& node -e "import('./scripts/release-source-fingerprint.mjs').then(({ computeSourceFingerprint }) => console.log(computeSourceFingerprint(process.argv[1])))" $repositoryRoot).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceFingerprint -notmatch "^[0-9a-f]{64}$") {
    throw "Could not compute the release source fingerprint."
}

$repositoryPathMatch = [regex]::Match($repositoryRoot, "^([A-Za-z]):\\(.*)$")
if (-not $repositoryPathMatch.Success) {
    throw "The repository must be on a Windows drive mounted under /mnt in WSL."
}
$driveLetter = $repositoryPathMatch.Groups[1].Value.ToLowerInvariant()
$relativeRepositoryPath = $repositoryPathMatch.Groups[2].Value.Replace("\", "/")
$wslRepositoryRoot = "/mnt/$driveLetter/$relativeRepositoryPath"
$wslSourceArchive = "$wslRepositoryRoot/.tmp/linux-release-source.tar"
$linuxNodeRoot = "$wslRepositoryRoot/.tmp/linux-node/node-v$nodeVersion-linux-x64"
$linuxNodeBin = "$linuxNodeRoot/bin"

New-Item -ItemType Directory -Force -Path $temporaryDirectory | Out-Null
$sourceFiles = @(& git -C $repositoryRoot ls-files --cached --others --exclude-standard) |
    Where-Object {
        $_ -and
        -not $_.StartsWith("artifacts/") -and
        -not $_.StartsWith("packages/native-linux-x64/native/") -and
        (Test-Path -LiteralPath (Join-Path $repositoryRoot $_) -PathType Leaf)
    }
if ($LASTEXITCODE -ne 0 -or $sourceFiles.Count -eq 0) {
    throw "Could not enumerate repository source files."
}

try {
    for ($offset = 0; $offset -lt $sourceFiles.Count; $offset += 50) {
        $lastIndex = [Math]::Min($offset + 49, $sourceFiles.Count - 1)
        $batch = $sourceFiles[$offset..$lastIndex]
        $archiveOption = if ($offset -eq 0) { "-cf" } else { "-rf" }
        & tar.exe -C $repositoryRoot $archiveOption $sourceArchive @batch
        if ($LASTEXITCODE -ne 0) {
            throw "Could not add repository source files to the WSL archive."
        }
    }
    & tar.exe -C $repositoryRoot -rf $sourceArchive `
        "packages/native-linux-x64/native" `
        "artifacts/ffmpeg-source-8.0-140fd653ae.tar.gz" `
        "artifacts/ffmpeg-source-8.0-140fd653ae.tar.gz.sha256" `
        "artifacts/matjash-pixi-native-$version.tgz"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not add Linux native and release inputs to the WSL archive."
    }

    $quotedCheckout = ConvertTo-BashLiteral $Checkout
    $quotedSourceArchive = ConvertTo-BashLiteral $wslSourceArchive
    Invoke-WslCommand @"
set -e
rm -rf -- $quotedCheckout
mkdir -p -- $quotedCheckout
tar -xf $quotedSourceArchive -C $quotedCheckout
chmod +x $quotedCheckout/packages/native-linux-x64/native/video/dist/linux-x64/ffmpeg
chmod +x $quotedCheckout/packages/native-linux-x64/native/video/dist/linux-x64/ffprobe
chmod +x $quotedCheckout/native/video/dist/linux-x64/ffmpeg
chmod +x $quotedCheckout/native/video/dist/linux-x64/ffprobe
"@

    $quotedNodeRoot = ConvertTo-BashLiteral $linuxNodeRoot
    $quotedNodeBin = ConvertTo-BashLiteral $linuxNodeBin
    $downloadUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeArchive"
    Invoke-WslCommand @"
set -e
if [ ! -x $quotedNodeRoot/bin/node ]; then
    mkdir -p $quotedNodeRoot/..
    curl -fsSL $(ConvertTo-BashLiteral $downloadUrl) -o /tmp/$nodeArchive
    echo '$nodeArchiveSha256  /tmp/$nodeArchive' | sha256sum -c -
    tar -xJf /tmp/$nodeArchive -C $quotedNodeRoot/..
    rm -f /tmp/$nodeArchive
fi
$quotedNodeBin/node --version
"@

    $environment = "PATH=$linuxNodeBin`:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    if ($LinuxLibraryPath) {
        $environment += " LD_LIBRARY_PATH=$(ConvertTo-BashLiteral $LinuxLibraryPath)"
    }
    $environment += " SDL_VIDEODRIVER=dummy PIXI_NATIVE_HEADLESS=1"
    $environment += " PIXI_NATIVE_SOURCE_FINGERPRINT=$sourceFingerprint"
    Invoke-WslCommand @"
set -e
cd $quotedCheckout
if env $environment ldd packages/native-linux-x64/native/video/dist/linux-x64/ffmpeg | grep 'not found'; then
    echo 'Install the missing Linux libraries or pass -LinuxLibraryPath.' >&2
    exit 1
fi
env $environment corepack pnpm install --frozen-lockfile
env $environment corepack pnpm pack:dist
"@

    $linuxArchiveName = "matjash-pixi-native-linux-x64-$version.tgz"
    Invoke-WslCommand @"
set -e
cp $quotedCheckout/artifacts/$linuxArchiveName $(ConvertTo-BashLiteral "$wslRepositoryRoot/artifacts/$linuxArchiveName")
cp $quotedCheckout/artifacts/$linuxArchiveName.sha256 $(ConvertTo-BashLiteral "$wslRepositoryRoot/artifacts/$linuxArchiveName.sha256")
cp $quotedCheckout/artifacts/release-manifest-linux-x64.json $(ConvertTo-BashLiteral "$wslRepositoryRoot/artifacts/release-manifest-linux-x64.json")
"@

    $windowsFacadeHash = Get-Sha256 $facadeArchive
    $linuxFacadeHash = (& wsl.exe @wslArguments -- sha256sum "$Checkout/artifacts/matjash-pixi-native-$version.tgz").Split()[0]
    if ($LASTEXITCODE -ne 0 -or $windowsFacadeHash -ne $linuxFacadeHash) {
        throw "Windows and Linux produced different facade archives."
    }

    Write-Host "Linux release package and manifest copied to artifacts/."
    Write-Host "Source fingerprint: $sourceFingerprint"
    Write-Host "Shared facade SHA-256: $($windowsFacadeHash.ToLowerInvariant())"
}
finally {
    Remove-Item -LiteralPath $sourceArchive -Force -ErrorAction SilentlyContinue
    if (-not $KeepCheckout) {
        $quotedCheckout = ConvertTo-BashLiteral $Checkout
        Invoke-WslCommand "rm -rf -- $quotedCheckout"
    }
}
