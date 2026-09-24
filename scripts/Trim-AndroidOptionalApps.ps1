$ErrorActionPreference = 'Stop'
if ($env:CAPACITOR_PLATFORM_NAME -and $env:CAPACITOR_PLATFORM_NAME -ne 'android') { exit 0 }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publicRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'android/app/src/main/assets/public'))
$ancestor = $publicRoot
while ($ancestor -and $ancestor.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
    if ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Generated web root must not cross links: $ancestor" }
    if ($ancestor -eq $projectRoot) { break }
    $ancestor = Split-Path -Parent $ancestor
}
$manifestPath = Join-Path $publicRoot 'official-app-assets.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Official APP build manifest missing; run pnpm build before cap sync.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$candidates = [Collections.Generic.List[string]]::new()
foreach ($relative in $manifest.files) {
    if ($relative -notmatch '^assets/[A-Za-z0-9_.-]+$' -or $relative.Contains('..')) { throw "Unsafe APP asset: $relative" }
    $candidates.Add((Join-Path $publicRoot $relative))
}
$packageRoot = Join-Path $publicRoot 'official-apps'
if (Test-Path -LiteralPath $packageRoot) {
    if ((Get-Item -LiteralPath $packageRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package directory must not be a link.' }
    foreach ($item in Get-ChildItem -LiteralPath $packageRoot -Recurse) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package assets must not be links.' }
        if (-not $item.PSIsContainer) { $candidates.Add($item.FullName) }
    }
}
$candidates.Add($manifestPath)
# Validate the complete generated-file list before deleting any file.
foreach ($candidate in $candidates) {
    $resolved = [IO.Path]::GetFullPath($candidate)
    if (-not $resolved.StartsWith($publicRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Asset escaped packaged web root.' }
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Missing generated asset: $resolved" }
    $item = Get-Item -LiteralPath $resolved
    if ($item.Attributes -band ([IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::Hidden)) { throw "Protected generated asset: $resolved" }
    $ancestor = Split-Path -Parent $resolved
    while ($ancestor -ne $publicRoot) {
        if ((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Asset path must not cross links: $ancestor" }
        $ancestor = Split-Path -Parent $ancestor
    }
}
foreach ($candidate in $candidates) { Remove-Item -LiteralPath $candidate }
Write-Host "Excluded $($candidates.Count) optional APP files from the APK web assets."
