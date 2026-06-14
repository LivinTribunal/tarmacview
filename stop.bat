@echo off
REM TarmacView - Windows stop script

cd /d "%~dp0"

echo Stopping TarmacView containers...
docker compose --env-file .env.docker down

echo.
echo Stopped. Your data is preserved.
echo To erase all data and start over, delete the Docker volume "pgdata"
echo from Docker Desktop -^> Volumes.
echo.
pause
