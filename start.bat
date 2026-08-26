@echo off
setlocal
cd /d "%~dp0"

REM Make sure any old instance on port 8461 is stopped first
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8461 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo Starting Master Beater on http://localhost:8461 ...
start "Master Beater" cmd /k "node server.js"

REM Give the server a moment to bind, then open the browser
timeout /t 2 /nobreak >nul
start "" "http://localhost:8461"

endlocal
