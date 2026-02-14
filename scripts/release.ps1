# PowerShell script to create a git tag and trigger the publish workflow
# Reads the version from package.json and creates a corresponding tag

# Get the version from package.json
$packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"

Write-Host "Creating tag $tag based on package.json version..." -ForegroundColor Green
if (git tag -l "$tag" | Where-Object { $_ }) {
	Write-Host "Tag $tag already exists. Aborting release." -ForegroundColor Red
	exit 1
}
git tag $tag

Write-Host "Pushing tag to remote..." -ForegroundColor Cyan
git push origin $tag

Write-Host "Done! Tag $tag has been created and pushed." -ForegroundColor Green
Write-Host "The GitHub Actions workflow will now build and publish the extension." -ForegroundColor Cyan
