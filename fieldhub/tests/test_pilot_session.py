"""pilot http-session presence tracker - the 'RC connected' signal's ttl logic."""

from app.core import pilot_session
from app.core.pilot_session import PilotSessionTracker


def test_fresh_tracker_is_not_connected():
    """a tracker that was never touched reports disconnected."""
    tracker = PilotSessionTracker(ttl_seconds=120.0)

    assert tracker.is_connected() is False


def test_touch_marks_connected_within_ttl(monkeypatch):
    """touch within the ttl window reports connected."""
    clock = {"now": 1000.0}
    monkeypatch.setattr(pilot_session.time, "monotonic", lambda: clock["now"])
    tracker = PilotSessionTracker(ttl_seconds=120.0)

    tracker.touch()
    assert tracker.is_connected() is True

    # still inside the ttl window
    clock["now"] += 119.0
    assert tracker.is_connected() is True


def test_connection_expires_after_ttl(monkeypatch):
    """activity older than the ttl ages out to disconnected."""
    clock = {"now": 500.0}
    monkeypatch.setattr(pilot_session.time, "monotonic", lambda: clock["now"])
    tracker = PilotSessionTracker(ttl_seconds=120.0)

    tracker.touch()
    clock["now"] += 121.0
    assert tracker.is_connected() is False


def test_reset_forgets_the_session(monkeypatch):
    """reset clears the last-seen so the tracker reads disconnected again."""
    clock = {"now": 0.0}
    monkeypatch.setattr(pilot_session.time, "monotonic", lambda: clock["now"])
    tracker = PilotSessionTracker(ttl_seconds=120.0)

    tracker.touch()
    assert tracker.is_connected() is True
    tracker.reset()
    assert tracker.is_connected() is False
