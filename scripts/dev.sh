#!/usr/bin/env bash
# dev mode - run the heavy infra (postgres, redis, minio) in docker and the apps
# natively with hot-reload, so you don't rebuild/compose the whole stack each time.
#
#   ./scripts/dev.sh          # start infra detached (postgres + redis + minio)
#   ./scripts/dev.sh down     # stop infra
#
# then run the apps natively, each in its own terminal (see the printout below).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${1:-up}" = "down" ]; then
  docker compose stop postgres redis minio minio-setup
  exit 0
fi

# infra only - no backend/worker/frontend containers
docker compose up -d postgres redis minio minio-setup

cat <<'EOF'

infra up:
  postgres  localhost:5432   user/pass/db: tarmacview
  redis     localhost:6379
  minio     localhost:9000   console http://localhost:9001  (tarmacview / tarmacview-minio)

run the apps natively (hot-reload), each in its own terminal:
  backend   cd backend && pip install -r requirements.txt -r requirements-video.txt \
              && alembic upgrade head && uvicorn app.main:app --reload
  worker    cd backend && celery -A app.workers.celery_app worker --loglevel=info
              # needs ffmpeg on PATH (brew install ffmpeg)
  frontend  cd frontend && npm install && npm run dev

backend -> http://localhost:8000     frontend -> http://localhost:5173 (vite proxies /api to :8000)
stop infra later with: ./scripts/dev.sh down
EOF
