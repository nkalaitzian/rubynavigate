# PowerShell script to delete and recreate the current version tag
# This forces the GitHub publish workflow to run again

# Get the version from package.json
$packageJson = Get-Content -Path "package.json" | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"

Write-Host "Deleting tag $tag locally..." -ForegroundColor Yellow
git tag -d $tag

Write-Host "Deleting tag $tag from remote..." -ForegroundColor Yellow
git push origin --delete $tag

Write-Host "Creating and pushing tag $tag..." -ForegroundColor Green
git tag $tag
git push origin $tag

Write-Host "Done! Tag $tag has been recreated and pushed." -ForegroundColor Green
Write-Host "The GitHub publish workflow should now execute." -ForegroundColor Cyan
