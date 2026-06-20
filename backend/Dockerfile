# stage 1: install dependencies
FROM python:3.12-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# the backend enqueues celery tasks to the worker, so it needs the celery client
# + redis broker at runtime (lazy-imported in measurement_service's enqueue seam).
# boto3 is here too: the offline tile bundle is pulled from minio via object_storage
# (lazy-imported), and the field profile needs it on the base backend image.
# the opencv engine stays worker-only (Dockerfile.worker installs requirements-video.txt).
# pins mirror requirements-video.txt; fold into requirements.txt when that absorbs the worker deps.
RUN pip install --no-cache-dir celery==5.4.0 redis==5.2.1 boto3==1.42.16

# stage 2: runtime
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY . .
RUN mkdir -p /app/static
EXPOSE 8000
RUN useradd --no-create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser
CMD ["sh", "-c", "python -m alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
