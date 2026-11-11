param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$source = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 1) { throw 'Unsupported or incomplete backup' }
$dump = Join-Path $source 'database.dump'
if ((Get-FileHash -LiteralPath $dump).Hash -ne $manifest.databaseSha256) { throw 'Database archive checksum mismatch' }
$sourceFiles = Join-Path $source 'uploads'
foreach ($file in $manifest.files) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $sourceFiles $file.path))
    if (!$candidate.StartsWith($sourceFiles + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup file path' }
    if ((Get-FileHash -LiteralPath $candidate).Hash -ne $file.sha256) { throw "Screenshot checksum mismatch: $($file.path)" }
}
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$rollback = Join-Path $taskRoot "backups\before-restore-$stamp"
$staging = Join-Path $taskRoot "backend\uploads-restore-$stamp"
$uploads = [IO.Path]::GetFullPath((Join-Path $taskRoot 'backend\uploads'))
if (!$uploads.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid uploads target' }
if (!$staging.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging target' }
New-Item -ItemType Directory -Path $rollback | Out-Null
Copy-Item -LiteralPath $sourceFiles -Destination $staging -Recurse
docker cp "$dump" tanbox_crm_postgres:/tmp/crm-restore.dump
if ($LASTEXITCODE -ne 0) { throw 'Cannot copy restore archive' }
docker exec tanbox_crm_postgres pg_restore --list /tmp/crm-restore.dump | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Invalid restore archive' }
$wasRunning = (docker inspect --format '{{.State.Running}}' tanbox_crm_backend) -eq 'true'
$restoreSucceeded = $false
try {
    if ($wasRunning) { docker compose stop backend; if ($LASTEXITCODE -ne 0) { throw 'Cannot stop backend' } }
    docker exec tanbox_crm_postgres pg_dump -U tanbox_crm -Fc -f /tmp/crm-rollback.dump tanbox_crm
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create rollback database dump' }
    docker cp tanbox_crm_postgres:/tmp/crm-rollback.dump "$rollback\database.dump"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot save rollback dump' }
    docker exec tanbox_crm_postgres pg_restore -U tanbox_crm -d tanbox_crm --clean --if-exists --single-transaction --exit-on-error /tmp/crm-restore.dump
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed; database transaction rolled back' }
    try {
        Move-Item -LiteralPath $uploads -Destination (Join-Path $rollback 'uploads')
        Move-Item -LiteralPath $staging -Destination $uploads
    } catch {
        docker exec tanbox_crm_postgres pg_restore -U tanbox_crm -d tanbox_crm --clean --if-exists --single-transaction --exit-on-error /tmp/crm-rollback.dump
        if ($LASTEXITCODE -ne 0) { throw 'Filesystem swap and database rollback failed; backend left stopped' }
        if (!(Test-Path -LiteralPath $uploads) -and (Test-Path -LiteralPath "$rollback\uploads")) { Move-Item -LiteralPath "$rollback\uploads" -Destination $uploads }
        throw
    }
    # Restored sessions and login codes must never become usable again.
    'DELETE FROM "AuthSession"; DELETE FROM "AuthCode"; DELETE FROM "SystemSetting" WHERE key = ''telegram-polling-lease'';' | docker exec -i tanbox_crm_postgres psql -U tanbox_crm -d tanbox_crm -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw 'Cannot revoke restored sessions; backend left stopped' }
    # A backup can predate the current application's schema. Never start the
    # new application against that older schema without running its migrations.
    docker compose run --rm --no-deps migrate
    if ($LASTEXITCODE -ne 0) { throw 'Restored database migration failed; backend left stopped. Rollback copy is preserved.' }
    $restoreSucceeded = $true
    Write-Output "Database and screenshots restored. Rollback copy: $rollback"
} finally {
    if ($restoreSucceeded -and $wasRunning) { docker compose up -d --force-recreate backend frontend }
}
