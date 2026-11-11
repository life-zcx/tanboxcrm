param([Parameter(Mandatory=$true)][string]$TelegramUserIds)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if ($TelegramUserIds -notmatch '^\d+(,\d+)*$') { throw 'Provide comma-separated numeric Telegram user IDs' }
if (Test-Path -LiteralPath (Join-Path $taskRoot '.env')) { throw '.env already exists; existing secrets will not be overwritten' }
function New-Secret {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
$password = New-Secret
$jwtSecret = New-Secret
$rootLines = @(
    "POSTGRES_PASSWORD=$password", "JWT_SECRET=$jwtSecret", "TELEGRAM_ALLOWED_USER_IDS=$TelegramUserIds",
    'APP_ORIGIN=http://127.0.0.1:3050', 'TELEGRAM_BOT_USERNAME=tanboxcrmbot', 'TELEGRAM_BOT_TOKEN=',
    'GOOGLE_GEMINI_API_KEY=', 'GEMINI_MODEL=gemini-3.5-flash-lite', 'GEMINI_FALLBACK_MODELS=', 'OPENAI_API_KEY='
)
[IO.File]::WriteAllLines((Join-Path $taskRoot '.env'), $rootLines, (New-Object Text.UTF8Encoding($false)))
$backendLines = $rootLines + @("DATABASE_URL=postgresql://tanbox_crm:$password@127.0.0.1:5434/tanbox_crm?schema=public", 'TELEGRAM_POLLING=false', 'HOST=127.0.0.1', 'PORT=5055')
if (!(Test-Path -LiteralPath (Join-Path $taskRoot 'backend\.env'))) { [IO.File]::WriteAllLines((Join-Path $taskRoot 'backend\.env'), $backendLines, (New-Object Text.UTF8Encoding($false))) }
Write-Output 'Configuration created. Set Telegram/Gemini API keys in .env, then run start-dev.bat.'
