@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Usage: restore-db.bat backups\crm-YYYYMMDD-HHMMSS
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore-db.ps1" -BackupDirectory "%~1"
exit /b %ERRORLEVEL%
