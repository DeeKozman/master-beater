@echo off
setlocal
echo Stopping Master Beater (port 8461) ...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8461 ^| findstr LISTENING 2^>nul') do (
    set FOUND=1
    echo   killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

if "%FOUND%"=="0" (
    echo   nothing was running on port 8461.
) else (
    echo Done.
)

endlocal
timeout /t 2 /nobreak >nul
