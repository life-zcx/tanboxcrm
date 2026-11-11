$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$target = Join-Path $taskRoot "backups\crm-$stamp"
New-Item -ItemType Directory -Path $target | Out-Null
$wasRunning = (docker inspect --format '{{.State.Running}}' tanbox_crm_backend 2>$null) -eq 'true'
try {
    if ($wasRunning) { docker stop tanbox_crm_backend | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Cannot stop backend for a consistent backup' } }
    docker exec tanbox_crm_postgres pg_dump -U tanbox_crm -Fc -f /tmp/crm-backup.dump tanbox_crm
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
    docker cp tanbox_crm_postgres:/tmp/crm-backup.dump "$target\database.dump"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot copy database dump' }
    docker exec tanbox_crm_postgres pg_restore --list /tmp/crm-backup.dump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Invalid backup archive' }
    Copy-Item -LiteralPath (Join-Path $taskRoot 'backend\uploads') -Destination (Join-Path $target 'uploads') -Recurse
    $manifest = @{ format = 1; databaseSha256 = (Get-FileHash -LiteralPath "$target\database.dump").Hash; createdAt = [DateTime]::UtcNow.ToString('o'); files = @() }
    $filesRoot = Join-Path $target 'uploads'
    $manifest.files = @(Get-ChildItem -LiteralPath $filesRoot -Recurse -File | ForEach-Object { @{ path = $_.FullName.Substring($filesRoot.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash } })
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$target\manifest.json" -Encoding UTF8
    Write-Output "Backup created: $target"
} catch { Write-Error $_; exit 1 }
finally { if ($wasRunning) { docker start tanbox_crm_backend | Out-Null } }
