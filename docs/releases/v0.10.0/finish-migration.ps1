$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$manifestPath = Join-Path $PSScriptRoot 'migration.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.status -eq 'completed') { Write-Output 'Migration already completed.'; exit 0 }
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot '.worktrees/qmonster-material-spike')).Path
if ([IO.Path]::GetFullPath($manifest.source) -ne $sourceRoot -or [IO.Path]::GetFullPath($manifest.root) -ne $projectRoot) { throw 'Migration roots do not match this project.' }
$verification = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/qa/root-migration-verification.json') -Raw | ConvertFrom-Json
if ($verification.status -ne 'passed' -or $verification.combinationsCompared -ne 864) { throw 'Root migration verification has not passed.' }
$moved = @($manifest.entries | Where-Object { $_.removeOriginal })
foreach ($entry in $manifest.entries) {
  $destination = [IO.Path]::GetFullPath((Join-Path $projectRoot $entry.to))
  if (-not $destination.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or $destination.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid destination.' }
  if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Missing destination: $destination" }
  $entry | Add-Member -NotePropertyName destinationSha256 -NotePropertyValue (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -Force
}
foreach ($entry in $moved) {
  $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $entry.from))
  if (-not $source.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source.' }
  $cursor = Get-Item -LiteralPath $source -Force
  while ($cursor.FullName -ne $projectRoot) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point: $($cursor.FullName)" }
    $cursor = Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($cursor.FullName)) -Force
  }
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Source changed: $source" }
}
$manifest.status = 'verified-removing-originals'
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
foreach ($entry in $moved) {
  $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $entry.from))
  if (-not $source.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid source.' }
  Remove-Item -LiteralPath $source -Force
  if (Test-Path -LiteralPath $source) { throw "Original still exists: $source" }
}
# Only remove these explicitly named directories if they are now empty.
foreach ($relative in @('packages/asset-catalog/assets/v0.10.0-candidate.1', 'packages/asset-catalog/catalog/v0.10.0-candidate.1', 'docs/integration/examples')) {
  $directory = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relative))
  if (-not $directory.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid empty directory.' }
  if ((Test-Path -LiteralPath $directory) -and @(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory }
}
$manifest.status = 'completed'
$manifest | Add-Member -NotePropertyName completedAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$manifest | Add-Member -NotePropertyName movedFileCount -NotePropertyValue $moved.Count -Force
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Moved $($moved.Count) dedicated files; shared utilities and historical evidence retained."
