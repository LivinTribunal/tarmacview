@echo off
REM TarmacView - Windows one-click launcher
REM Double-click this file to start the application.

setlocal

cd /d "%~dp0"

echo ============================================================
echo   TarmacView - starting up
echo ============================================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not installed.
    echo.
    echo Please install Docker Desktop from:
    echo   https://www.docker.com/products/docker-desktop/
    echo.
    echo After installing, start Docker Desktop and run this file again.
    echo.
    pause
    exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker Desktop is installed but not running.
    echo.
    echo Please open Docker Desktop, wait until it says "Engine running",
    echo then run this file again.
    echo.
    pause
    exit /b 1
)

REM generate .env.docker on first run so JWT_SECRET is unique per install
if not exist ".env.docker" (
    echo First run - generating .env.docker with a random JWT secret...
    powershell -NoProfile -Command "$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); $hex = -join ($bytes | ForEach-Object { '{0:x2}' -f $_ }); 'JWT_SECRET=' + $hex | Out-File -FilePath '.env.docker' -Encoding ascii -NoNewline"
    if errorlevel 1 (
        echo [ERROR] Could not generate .env.docker. PowerShell may be blocked.
        pause
        exit /b 1
    )
    echo Wrote .env.docker ^(do not share or commit this file^).
    echo.
)

echo Building and starting containers (this can take 5-10 minutes the first time)...
echo.

docker compose --env-file .env.docker up -d --build
if errorlevel 1 (
    echo.
    echo [ERROR] Something went wrong starting the containers.
    echo Check the messages above. If you need help, send them to Stefan.
    echo.
    pause
    exit /b 1
)

echo.
echo Waiting for the application to come online...
echo.

set /a tries=0
:wait_loop
set /a tries+=1
curl -s -o nul -w "%%{http_code}" http://localhost/ > "%TEMP%\tarmacview_status.txt" 2>nul
set /p status=<"%TEMP%\tarmacview_status.txt"
del "%TEMP%\tarmacview_status.txt" >nul 2>nul
if "%status%"=="200" goto ready
if %tries% GEQ 60 goto timeout
timeout /t 2 /nobreak >nul
goto wait_loop

:ready
echo ============================================================
echo   TarmacView is running!
echo ============================================================
echo.
echo Open your browser at:  http://localhost
echo.
echo To stop the application, run stop.bat
echo.
start http://localhost
pause
exit /b 0

:timeout
echo.
echo The app did not respond within 2 minutes. It may still be starting.
echo Open Docker Desktop to check the container status, or try opening
echo   http://localhost
echo in your browser in a minute.
echo.
pause
exit /b 0
