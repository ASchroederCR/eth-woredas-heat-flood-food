# Publish app\ to the gh-pages branch (GitHub Pages) as a single commit with no history, so the
# daily data refresh doesn't pile ~5 MB a day into the repository. Leaves main, its index and the
# working tree untouched. Skips the push when app\ hasn't changed since the last publish.
# Run by refresh_daily.ps1; can also be run by hand:  powershell -File publish_pages.ps1
$ErrorActionPreference = 'Continue'   # git writes progress to stderr; check exit codes instead
$root = $PSScriptRoot
Set-Location $root
$env:GIT_TERMINAL_PROMPT = '0'

# author of the published commit (matches the repository's existing commits)
$env:GIT_AUTHOR_NAME = 'Andrew Schroeder'; $env:GIT_AUTHOR_EMAIL = 'andrew.schroeder@gatesfoundation.org'
$env:GIT_COMMITTER_NAME = $env:GIT_AUTHOR_NAME; $env:GIT_COMMITTER_EMAIL = $env:GIT_AUTHOR_EMAIL

# stage app\ into a throwaway index, with app\ as the root of the tree
$tmpIndex = Join-Path ([IO.Path]::GetTempPath()) ("pages-index-" + [guid]::NewGuid())
$env:GIT_INDEX_FILE = $tmpIndex
$gitDir = Join-Path $root '.git'
Push-Location (Join-Path $root 'app')
try {
    git --git-dir="$gitDir" --work-tree=. add -A .
    if ($LASTEXITCODE) { throw "git add failed" }
    $tree = (git --git-dir="$gitDir" write-tree).Trim()
    if ($LASTEXITCODE -or -not $tree) { throw "git write-tree failed" }
} finally {
    Pop-Location
    Remove-Item Env:GIT_INDEX_FILE
    Remove-Item $tmpIndex -ErrorAction SilentlyContinue
}

$stampFile = Join-Path $root 'build\logs\last_pages_tree.txt'
if ((Test-Path $stampFile) -and ((Get-Content $stampFile -Raw).Trim() -eq $tree)) {
    Write-Output "gh-pages: app\ unchanged (tree $($tree.Substring(0, 10))), nothing to publish"
    exit 0
}

$msg = "Publish map data $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$commit = (git commit-tree $tree -m $msg).Trim()
git push origin "${commit}:refs/heads/gh-pages" --force
if ($LASTEXITCODE) { throw "push to gh-pages failed" }
New-Item -ItemType Directory -Force (Split-Path $stampFile) | Out-Null
Set-Content $stampFile $tree -Encoding ascii
Write-Output "gh-pages: published $($commit.Substring(0, 10)) (tree $($tree.Substring(0, 10)))"
