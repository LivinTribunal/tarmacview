#!/usr/bin/env bash
# TarmacView - stop script for macOS / Linux
set -e

cd "$(dirname "$0")"

echo "============================================================"
echo "  TarmacView - stopping"
echo "============================================================"
echo

if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Docker is not installed - nothing to stop."
    exit 1
fi

echo "Stopping TarmacView containers..."
docker compose --env-file .env.docker down

echo
echo "Stopped. Your data is preserved."
echo 'To erase all data and start over, run: docker volume rm pgdata'
echo
