# Daily refresh of the woreda heat map: latest observed days, the new forecast, the map data,
# then the river flood gauges and food prices, and publishes app\ to GitHub Pages.
# Run by the Windows scheduled task "Ethiopia woreda heat refresh" (see README). Log: build\logs\refresh.log
$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$py = if ($env:HEAT_PYTHON) { $env:HEAT_PYTHON } else { (Get-Command python -ErrorAction Stop).Source }
$logDir = Join-Path $root 'build\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'refresh.log'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUNBUFFERED = '1'
Set-Location $root

function Step($name, [string[]]$pyArgs) {
    Add-Content $log "--- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $name" -Encoding utf8
    & $py @pyArgs 2>&1 | ForEach-Object { "$_" } | Out-File $log -Append -Encoding utf8
    Add-Content $log "--- $name exit $LASTEXITCODE" -Encoding utf8
    return $LASTEXITCODE
}

$a = Step 'download final' @('heat_api.py', 'download', 'final')   # re-pull the two latest months
$b = Step 'forecast' @('heat_api.py', 'forecast')                   # replace the forecast days
$c = Step 'build' @('build_map_data.py')                            # rebuild app\data even if a pull failed
$d = Step 'flood gauges' @('flood_gauges.py', 'all')                # GloFAS discharge + forecast -> app\data\flood.js
$e = Step 'food prices' @('food_prices.py', 'build')                # re-link markets to the new months (no download)

# publish app\ to GitHub Pages (only if the builds succeeded, so a failed run never replaces a good site)
Add-Content $log "--- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') publish" -Encoding utf8
if ($c -or $d -or $e) {
    Add-Content $log "skipped: a build step failed" -Encoding utf8; $f = 1
} else {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'publish_pages.ps1') 2>&1 | ForEach-Object { "$_" } | Out-File $log -Append -Encoding utf8
    $f = $LASTEXITCODE
}
Add-Content $log "--- publish exit $f" -Encoding utf8
Add-Content $log "=== done $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') (download $a, forecast $b, build $c, flood $d, food $e, publish $f)`n" -Encoding utf8

# keep the log to its last ~2000 lines
$lines = Get-Content $log
if ($lines.Count -gt 2000) { $lines[-2000..-1] | Set-Content $log -Encoding utf8 }
exit ([int]($a -or $b -or $c -or $d -or $e -or $f))
