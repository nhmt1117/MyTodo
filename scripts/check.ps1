param(
    [ValidateSet('quick', 'full', 'release')]
    [string]$Level = 'quick'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    npm run check
    if ($Level -in @('full', 'release')) {
        npm run build:win
    }
    if ($Level -eq 'release') {
        npm run verify:release
    }
}
finally {
    Pop-Location
}
