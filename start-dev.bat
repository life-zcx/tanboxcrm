@echo off
cd /d "%~dp0"
docker compose up -d --build --wait
if errorlevel 1 exit /b 1
start "" "http://127.0.0.1:3050"
