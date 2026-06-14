"""celery app + broker config for background video-processing jobs.

the worker container runs `celery -A app.workers.celery_app worker`. measurement
tasks land here in phase 2; for now this only wires the broker so the worker
boots. broker + result backend default to the compose redis, overridden by
REDIS_URL.
"""

import os

from celery import Celery

# redis broker + result backend; compose sets REDIS_URL, falls back to the
# in-compose redis service
redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery("tarmacview", broker=redis_url, backend=redis_url)

# late acks + single prefetch - video jobs are long, so a worker should not
# hoard queued tasks and should only ack after the job finishes
celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)


@celery_app.task(name="workers.ping")
def ping() -> str:
    """liveness task - returns pong so the worker wiring can be smoke-tested."""
    return "pong"
