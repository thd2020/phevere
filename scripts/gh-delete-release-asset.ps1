# Replace a same-named GitHub Release asset (immutable releases cannot overwrite).
# Env: GH_TOKEN, GITHUB_REPOSITORY, TAG, ASSET
$relJson = gh api "repos/$env:GITHUB_REPOSITORY/releases/tags/$env:TAG" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "No release yet for $env:TAG"
  exit 0
}
$rel = $relJson | ConvertFrom-Json
$hit = @($rel.assets) | Where-Object { $_.name -eq $env:ASSET } | Select-Object -First 1
if ($hit) {
  Write-Host "Deleting existing $($hit.name) id=$($hit.id)"
  gh api -X DELETE "repos/$env:GITHUB_REPOSITORY/releases/assets/$($hit.id)"
} else {
  Write-Host "No existing asset named $env:ASSET"
}
