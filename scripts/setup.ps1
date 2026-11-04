param()
$ErrorActionPreference = 'Stop'
$skillDir = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $PSScriptRoot 'setup.mjs'

try {
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $npm = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node -and $npm) {
        & $node.Source -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)'
        if ($LASTEXITCODE -eq 0) {
            & $node.Source $setup
            exit $LASTEXITCODE
        }
    }

    $version = 'v25.5.0'
    $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    if ($architecture -notin @('x64', 'arm64')) { throw "Unsupported Windows CPU architecture: $architecture" }
    $archive = "node-$version-win-$architecture.zip"
    if ($env:SUBLANG_CACHE_DIR) { $cache = $env:SUBLANG_CACHE_DIR }
    elseif ($env:XDG_CACHE_HOME) { $cache = Join-Path $env:XDG_CACHE_HOME 'sublang-skill' }
    else { $cache = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache/sublang-skill' }
    $nodeDir = Join-Path $cache "node-$version-win-$architecture"
    $nodeExe = Join-Path $nodeDir 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
        New-Item -ItemType Directory -Path $cache -Force | Out-Null
        $work = Join-Path $cache ('.node-download-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $work | Out-Null
        try {
            $checksumFile = Join-Path $skillDir 'runtime/node-checksums.txt'
            $lines = @(Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match ('^[0-9a-f]{64}\s+' + [Regex]::Escape($archive) + '$') })
            if ($lines.Count -ne 1) { throw 'No pinned Node checksum for this Windows architecture.' }
            $expected = ($lines[0] -split '\s+')[0]
            $download = Join-Path $work $archive
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$version/$archive" -OutFile $download
            $actual = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expected) { throw 'Node archive checksum mismatch.' }
            Expand-Archive -LiteralPath $download -DestinationPath $work
            if (-not (Test-Path -LiteralPath $nodeDir)) {
                Move-Item -LiteralPath (Join-Path $work "node-$version-win-$architecture") -Destination $nodeDir
            }
        } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    }
    $env:Path = "$nodeDir;$env:Path"
    & $nodeExe $setup
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
