@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup-db.ps1"
exit /b %ERRORLEVEL%
