"""pilot http-session presence - the 'RC connected' signal.

a real RC only shows 'online' over MQTT once an aircraft is attached, but the
controller is connected to the hub the moment pilot logs in and keeps making
authenticated calls (workspace, wayline sync). this tracker is that http-session
heartbeat, expired by the same ttl as the mqtt online window so the two signals
age on one clock.
"""

import time

from app.core.config import settings


class PilotSessionTracker:
    """in-process last-seen heartbeat for pilot's authenticated http traffic."""

    def __init__(self, ttl_seconds: float):
        """track presence with the given inactivity ttl (seconds)."""
        self._ttl = ttl_seconds
        self._last_seen: float | None = None

    def touch(self) -> None:
        """mark pilot active as of now."""
        self._last_seen = time.monotonic()

    def is_connected(self) -> bool:
        """true while the last activity is within the ttl."""
        if self._last_seen is None:
            return False
        return (time.monotonic() - self._last_seen) <= self._ttl

    def reset(self) -> None:
        """forget the session (test helper)."""
        self._last_seen = None


# process-wide session, ttl shared with the device online window
session = PilotSessionTracker(ttl_seconds=settings.device_offline_ttl_s)
