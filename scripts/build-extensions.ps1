$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$extensionRoot = Join-Path $repoRoot 'extension'
$manifestRoot = Join-Path $repoRoot 'manifests'
$distRoot = Join-Path $repoRoot 'dist'
$packageRoot = Join-Path $distRoot 'packages'

$baseManifest = Get-Content -Raw (Join-Path $extensionRoot 'manifest.json') | ConvertFrom-Json
$version = $baseManifest.version

$targets = @(
  @{
    Name = 'brave'
    Manifest = Join-Path $manifestRoot 'brave.manifest.json'
    Package = "codex-auth-exporter-brave-v$version.zip"
  },
  @{
    Name = 'firefox'
    Manifest = Join-Path $manifestRoot 'firefox.manifest.json'
    Package = "codex-auth-exporter-firefox-v$version.zip"
  }
)

if (Test-Path $distRoot) {
  Remove-Item -LiteralPath $distRoot -Recurse -Force
}

New-Item -ItemType Directory -Force $packageRoot | Out-Null

foreach ($target in $targets) {
  $targetRoot = Join-Path $distRoot $target.Name
  New-Item -ItemType Directory -Force $targetRoot | Out-Null

  Copy-Item -Path (Join-Path $extensionRoot '*') -Destination $targetRoot -Recurse -Force
  Copy-Item -Path $target.Manifest -Destination (Join-Path $targetRoot 'manifest.json') -Force

  $packagePath = Join-Path $packageRoot $target.Package
  Compress-Archive -Path (Join-Path $targetRoot '*') -DestinationPath $packagePath -Force

  Write-Host "Built $($target.Name): $targetRoot"
  Write-Host "Packaged $($target.Name): $packagePath"
}
