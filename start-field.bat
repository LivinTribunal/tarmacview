@echo off
REM TarmacView - Windows one-click launcher for the offline field stack.
REM
REM Brings up the full docker compose "field" profile (backend + frontend +
REM fieldhub + EMQX + MinIO) with zero hand-editing: detects the laptop's LAN
REM IP, mints TLS via scripts\field-hub\gen-certs.sh, fills .env.docker
REM non-destructively, and starts the stack. Safe to re-run - the CA and any
REM existing secrets/creds are reused.
REM
REM Usage: double-click, or  start-field.bat [LAN_IP]
REM Cert generation needs bash + openssl - install Git for Windows, which
REM bundles both, before first run.

setlocal

cd /d "%~dp0"

echo ============================================================
echo   TarmacView - field stack starting up
echo ============================================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not installed.
    echo.
    echo Please install Docker Desktop from:
    echo   https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker Desktop is installed but not running.
    echo Open Docker Desktop, wait until it says "Engine running", then retry.
    echo.
    pause
    exit /b 1
)

REM resolve the LAN IP that the whole run agrees on (certs, device addrs,
REM printed hub url). explicit arg wins; else a stored host is kept so re-runs
REM stay consistent; else auto-detect for the first run.
set "HUB_IP="
set "IP_EXPLICIT=0"
if not "%~1"=="" goto ip_explicit
goto ip_stored

:ip_explicit
call :validate_ip "%~1"
if errorlevel 1 (
    echo [ERROR] '%~1' is not an IPv4 address. Pass the laptop's LAN IP, e.g. 192.168.8.100
    pause
    exit /b 1
)
set "HUB_IP=%~1"
set "IP_EXPLICIT=1"
goto ip_done

:ip_stored
call :get_value FIELDHUB_PUBLIC_HOST
if not "%RESULT%"=="" set "HUB_IP=%RESULT%"
if not "%HUB_IP%"=="" goto ip_done
call :detect_ip
set "HUB_IP=%RESULT%"
if "%HUB_IP%"=="" (
    echo [ERROR] Could not auto-detect a LAN IP. Re-run with it explicitly:
    echo   start-field.bat 192.168.8.100
    pause
    exit /b 1
)
goto ip_done

:ip_done
echo Using LAN IP: %HUB_IP%
echo.

REM base secret the backend hard-requires, plus the hub shared secret
call :ensure_secret JWT_SECRET
call :ensure_secret FIELDHUB_SHARED_SECRET

REM backend -> fieldhub proxy is auto-wired by docker-compose.field.yml (loaded
REM in the compose command below), so FIELDHUB_URL/FIELDHUB_CA stay out of
REM .env.docker - that keeps a plain "docker compose up" hub-free.

REM device-facing addresses Pilot 2 connects to - derived from the LAN IP.
REM an explicit IP arg updates them; a bare re-run keeps the stored values.
if "%IP_EXPLICIT%"=="1" (
    call :set_force FIELDHUB_PUBLIC_HOST "%HUB_IP%"
    call :set_force FIELDHUB_MQTT_DEVICE_ADDR "ssl://%HUB_IP%:8883"
    call :set_force FIELDHUB_MINIO_DEVICE_ENDPOINT "http://%HUB_IP%:9000"
) else (
    call :set_if_empty FIELDHUB_PUBLIC_HOST "%HUB_IP%"
    call :set_if_empty FIELDHUB_MQTT_DEVICE_ADDR "ssl://%HUB_IP%:8883"
    call :set_if_empty FIELDHUB_MINIO_DEVICE_ENDPOINT "http://%HUB_IP%:9000"
)

REM pilot + dji + minio creds: carry what is set, prompt otherwise (blank skips)
call :set_if_empty FIELDHUB_PILOT_USERNAME "pilot"
echo Field credentials (stored in .env.docker, never shared or committed):
call :prompt_value FIELDHUB_PILOT_PASSWORD "Pilot login password" 1
call :prompt_value FIELDHUB_DJI_APP_ID "DJI app id" 0
call :prompt_value FIELDHUB_DJI_APP_KEY "DJI app key" 0
call :prompt_value FIELDHUB_DJI_APP_LICENSE "DJI app license" 0
call :prompt_value MINIO_ROOT_USER "MinIO root user" 0
call :prompt_value MINIO_ROOT_PASSWORD "MinIO root password" 1
echo.

REM TLS material - reuses the CA across runs, regenerates service certs.
REM gen-certs.sh is a shell script; run it through Git for Windows' bash.
where bash >nul 2>nul
if errorlevel 1 (
    echo [ERROR] bash not found. Install Git for Windows (bundles bash + openssl):
    echo   https://git-scm.com/download/win
    pause
    exit /b 1
)
echo Generating TLS material for %HUB_IP%...
bash "scripts/field-hub/gen-certs.sh" %HUB_IP%
if errorlevel 1 (
    echo [ERROR] TLS generation failed. See the messages above.
    pause
    exit /b 1
)
echo.

echo Building and starting the field stack (5-10 min on first run)...
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.field.yml --profile field up -d --build
if errorlevel 1 (
    echo.
    echo [ERROR] Something went wrong starting the containers.
    echo Check the messages above. If you need help, send them to Stefan.
    echo.
    pause
    exit /b 1
)
echo.

echo ============================================================
echo   TarmacView field stack is up
echo ============================================================
echo   Web app:        http://localhost
echo   DJI Pilot 2:    https://%HUB_IP%:8443
echo.
echo   On each RC (once): install the local CA at certs\ca\ca.crt,
echo   then point Pilot 2's Cloud Service at the hub URL above.
echo.

call :note_if_empty FIELDHUB_PILOT_PASSWORD
call :note_if_empty FIELDHUB_DJI_APP_ID
call :note_if_empty FIELDHUB_DJI_APP_KEY
call :note_if_empty FIELDHUB_DJI_APP_LICENSE
echo.

pause
exit /b 0

REM ---------------------------------------------------------------------------
REM subroutines - .env.docker lives in the current dir; the file is git-ignored
REM ---------------------------------------------------------------------------

:validate_ip
echo %~1|findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
goto :eof

:detect_ip
set "RESULT="
powershell -NoProfile -Command "$i = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }; $p = $i | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.*' }; if ($p) { ($p | Select-Object -First 1).IPAddress } elseif ($i) { ($i | Select-Object -First 1).IPAddress }" > "%TEMP%\tv_field_ip.txt" 2>nul
set /p RESULT=<"%TEMP%\tv_field_ip.txt"
del "%TEMP%\tv_field_ip.txt" >nul 2>nul
goto :eof

:get_value
set "RESULT="
set "GK=%~1"
powershell -NoProfile -Command "$f='.env.docker'; if (Test-Path $f) { $m = Get-Content $f | Where-Object { $_ -match ('^' + $env:GK + '=') } | Select-Object -Last 1; if ($m) { ($m -replace ('^' + $env:GK + '='), '') } }" > "%TEMP%\tv_field_val.txt" 2>nul
set /p RESULT=<"%TEMP%\tv_field_val.txt"
del "%TEMP%\tv_field_val.txt" >nul 2>nul
goto :eof

:set_force
set "EK=%~1"
set "EV=%~2"
powershell -NoProfile -Command "$f='.env.docker'; $k=$env:EK; $v=$env:EV; $lines=@(); if (Test-Path $f) { $lines=@(Get-Content $f) }; $lines=@($lines | Where-Object { $_ -notmatch ('^' + $k + '=') }); $lines += ($k + '=' + $v); Set-Content -Path $f -Value $lines -Encoding ascii"
goto :eof

:set_if_empty
set "EK=%~1"
set "EV=%~2"
powershell -NoProfile -Command "$f='.env.docker'; $k=$env:EK; $v=$env:EV; $lines=@(); if (Test-Path $f) { $lines=@(Get-Content $f) }; $cur=''; $m=$lines | Where-Object { $_ -match ('^' + $k + '=') } | Select-Object -Last 1; if ($m) { $cur=($m -replace ('^' + $k + '='), '') }; if ([string]::IsNullOrWhiteSpace($cur)) { $lines=@($lines | Where-Object { $_ -notmatch ('^' + $k + '=') }); $lines += ($k + '=' + $v); Set-Content -Path $f -Value $lines -Encoding ascii }"
goto :eof

:ensure_secret
set "EK=%~1"
powershell -NoProfile -Command "$f='.env.docker'; $k=$env:EK; $lines=@(); if (Test-Path $f) { $lines=@(Get-Content $f) }; $cur=''; $m=$lines | Where-Object { $_ -match ('^' + $k + '=') } | Select-Object -Last 1; if ($m) { $cur=($m -replace ('^' + $k + '='), '') }; if ([string]::IsNullOrWhiteSpace($cur)) { $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $v=-join ($b | ForEach-Object { '{0:x2}' -f $_ }); $lines=@($lines | Where-Object { $_ -notmatch ('^' + $k + '=') }); $lines += ($k + '=' + $v); Set-Content -Path $f -Value $lines -Encoding ascii }"
goto :eof

:prompt_value
set "EK=%~1"
set "ELABEL=%~2"
set "ESECRET=%~3"
powershell -NoProfile -Command "$f='.env.docker'; $k=$env:EK; $lines=@(); if (Test-Path $f) { $lines=@(Get-Content $f) }; $cur=''; $m=$lines | Where-Object { $_ -match ('^' + $k + '=') } | Select-Object -Last 1; if ($m) { $cur=($m -replace ('^' + $k + '='), '') }; if (-not [string]::IsNullOrWhiteSpace($cur)) { return }; if ([Console]::IsInputRedirected) { return }; if ($env:ESECRET -eq '1') { $s=Read-Host -AsSecureString ('  ' + $env:ELABEL + ' (blank to skip)'); $v=[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) } else { $v=Read-Host ('  ' + $env:ELABEL + ' (blank to skip)') }; if (-not [string]::IsNullOrWhiteSpace($v)) { $lines=@($lines | Where-Object { $_ -notmatch ('^' + $k + '=') }); $lines += ($k + '=' + $v); Set-Content -Path $f -Value $lines -Encoding ascii }"
goto :eof

:note_if_empty
call :get_value %~1
if "%RESULT%"=="" echo   Note: %~1 is empty - set it in .env.docker before field use.
goto :eof
