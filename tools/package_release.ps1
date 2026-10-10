param([string]$OutputDirectory = "")
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = (Get-Content -LiteralPath (Join-Path $Root "VERSION") -Raw).Trim()
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path $Root -Parent) "release" }
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
python (Join-Path $Root "tools\validate_site.py") --root $Root
if ($LASTEXITCODE -ne 0) { throw "Site validation failed" }
$Archive = Join-Path $OutputDirectory "northwest-desertification-site-$Version.tar.gz"
$Parent = Split-Path $Root -Parent; $Folder = Split-Path $Root -Leaf
tar.exe -czf $Archive --exclude="$Folder/.git" --exclude="$Folder/__pycache__" --exclude="$Folder/*/__pycache__" --exclude="$Folder/*.pyc" --exclude="$Folder/release" --exclude="$Folder/*.tar.gz" --exclude="$Folder/*.sha256" -C $Parent $Folder
if ($LASTEXITCODE -ne 0) { throw "tar packaging failed" }
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant()
$HashPath = "$Archive.sha256"
"$Hash  $(Split-Path $Archive -Leaf)" | Set-Content -LiteralPath $HashPath -Encoding ascii
Write-Output $Archive
Write-Output $HashPath
