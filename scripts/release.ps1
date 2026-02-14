# PowerShell script to create a git tag and trigger the publish workflow
# Reads the version from package.json and creates a corresponding tag

# Get the version from package.json
$packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"

Write-Host "Preparing to release version $version (tag: $tag)..." -ForegroundColor Green

# Check if tag already exists locally
if (git tag -l "$tag" | Where-Object { $_ }) {
    Write-Host "Tag $tag already exists locally." -ForegroundColor Yellow
    $response = Read-Host "Do you want to delete and recreate it? (y/N)"
    
    if ($response -ne 'y' -and $response -ne 'Y') {
        Write-Host "Release aborted." -ForegroundColor Red
        exit 1
    }
    
    # Delete local tag
    Write-Host "Deleting local tag $tag..." -ForegroundColor Cyan
    git tag -d $tag
    
    # Try to delete remote tag (may fail if it doesn't exist remotely, which is fine)
    Write-Host "Deleting remote tag $tag..." -ForegroundColor Cyan
    git push origin --delete $tag 2>$null
}

# Create the tag
Write-Host "Creating tag $tag..." -ForegroundColor Green
git tag $tag

# Push the tag
Write-Host "Pushing tag to remote..." -ForegroundColor Cyan
git push origin $tag

Write-Host "Done! Tag $tag has been created and pushed." -ForegroundColor Green
Write-Host "The GitHub Actions workflow will now build and publish the extension." -ForegroundColor Cyan
