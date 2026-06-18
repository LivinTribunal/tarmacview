"""celery app + broker config for background video-processing jobs.

the worker container runs `celery -A app.workers.celery_app worker`. measurement
tasks live in `app.workers.measurement_tasks` and are registered via `include`.
broker + result backend default to the compose redis, overridden by REDIS_URL.
"""

import os

from celery import Celery

# redis broker + result backend; compose sets REDIS_URL to the in-compose redis,
# native dev falls back to localhost
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# per-task ttl - a job that hangs (or whose worker wedges) is killed instead of
# running forever. soft raises SoftTimeLimitExceeded inside the task so the runner
# routes the measurement to ERROR; hard SIGKILLs if soft handling can't unwind.
# override via env for unusually long footage.
soft_time_limit = int(os.getenv("MEASUREMENT_SOFT_TIME_LIMIT", "1800"))
hard_time_limit = int(os.getenv("MEASUREMENT_TIME_LIMIT", "2100"))

celery_app = Celery(
    "tarmacview",
    broker=redis_url,
    backend=redis_url,
    include=["app.workers.measurement_tasks"],
)

# late acks + single prefetch - video jobs are long, so a worker should not
# hoard queued tasks and should only ack after the job finishes
celery_app.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=soft_time_limit,
    task_time_limit=hard_time_limit,
)


@celery_app.task(name="workers.ping")
def ping() -> str:
    """liveness task - returns pong so the worker wiring can be smoke-tested."""
    return "pong"
