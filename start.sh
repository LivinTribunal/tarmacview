#!/usr/bin/env bash
# TarmacView - one-shot launcher for macOS / Linux
set -e

cd "$(dirname "$0")"

echo "============================================================"
echo "  TarmacView - starting up"
echo "============================================================"
echo

if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Docker is not installed."
    echo "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "[ERROR] Docker is installed but not running. Start Docker Desktop and try again."
    exit 1
fi

# generate .env.docker on first run so JWT_SECRET is unique per install
if [ ! -f .env.docker ]; then
    echo "First run - generating .env.docker with a random JWT secret..."
    if command -v openssl >/dev/null 2>&1; then
        jwt_secret=$(openssl rand -hex 32)
    elif [ -r /dev/urandom ]; then
        jwt_secret=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 64)
    else
        echo "[ERROR] No random source available (openssl or /dev/urandom)."
        exit 1
    fi
    umask 077
    printf 'JWT_SECRET=%s\n' "$jwt_secret" > .env.docker
    echo "Wrote .env.docker (do not share or commit this file)."
fi

echo "Building and starting containers (5-10 min on first run)..."
docker compose --env-file .env.docker up -d --build

echo
echo "Waiting for the app to come online..."
for i in $(seq 1 60); do
    if curl -fsS -o /dev/null http://localhost/; then
        echo
        echo "============================================================"
        echo "  TarmacView is running at http://localhost"
        echo "============================================================"
        if command -v open >/dev/null 2>&1; then
            open http://localhost
        elif command -v xdg-open >/dev/null 2>&1; then
            xdg-open http://localhost >/dev/null 2>&1 || true
        fi
        exit 0
    fi
    sleep 2
done

echo "App did not respond within 2 minutes. Check 'docker compose logs' or open http://localhost manually."
