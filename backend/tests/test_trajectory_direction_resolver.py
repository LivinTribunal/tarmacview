"""unit tests for the orchestrator's direction-resolution pre-pass.

covers the three priority cases:
  (a) inspection pinned wins over mission default
  (b) inspection inherits from a concrete mission default
  (c) mission AUTO + inspection inherit triggers the solver
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.services.trajectory.orchestrator import _resolve_inspection_directions


def _insp(method: str = "FLY_OVER", direction: str | None = None, resolved: str | None = None):
    """build a tiny inspection stand-in with just the fields the resolver reads."""
    config = SimpleNamespace(
        direction=direction,
        resolved_direction=resolved,
    )
    return SimpleNamespace(
        id=uuid4(),
        sequence_order=1,
        method=method,
        config=config,
        template=None,
    )


def _mission(direction: str = "AUTO"):
    """mission stub exposing only `direction`."""
    return SimpleNamespace(direction=direction)


def test_inspection_pinned_wins_over_mission(monkeypatch):
    """case (a) - inspection.config.direction overrides whatever the mission says."""
    from app.services.trajectory import heading_optimizer

    insp = _insp(direction="REVERSED")
    insp.sequence_order = 1
    mission = _mission(direction="NATURAL")

    captured = {}

    def fake_solve(inspections, surfaces, *, auto_ids, initial_reversed):
        """capture solver inputs without running the brute force."""
        captured["auto_ids"] = set(auto_ids)
        captured["initial_reversed"] = dict(initial_reversed)
        return SimpleNamespace(
            assignments=[
                SimpleNamespace(inspection_id=i.id, reversed=initial_reversed[i.id], is_auto=False)
                for i in inspections
            ]
        )

    monkeypatch.setattr(heading_optimizer, "solve_headings", fake_solve)

    resolved = _resolve_inspection_directions([insp], mission, surfaces=[])

    assert resolved[insp.id] is True
    assert insp.config.resolved_direction == "REVERSED"
    assert captured["auto_ids"] == set()


def test_inspection_inherits_concrete_mission_default(monkeypatch):
    """case (b) - inspection.direction is null and mission pins NATURAL/REVERSED."""
    from app.services.trajectory import heading_optimizer

    insp = _insp(direction=None)
    mission = _mission(direction="REVERSED")

    captured = {}

    def fake_solve(inspections, surfaces, *, auto_ids, initial_reversed):
        """no auto inspections expected; record state so we can assert."""
        captured["auto_ids"] = set(auto_ids)
        captured["initial_reversed"] = dict(initial_reversed)
        return SimpleNamespace(
            assignments=[
                SimpleNamespace(inspection_id=i.id, reversed=initial_reversed[i.id], is_auto=False)
                for i in inspections
            ]
        )

    monkeypatch.setattr(heading_optimizer, "solve_headings", fake_solve)

    resolved = _resolve_inspection_directions([insp], mission, surfaces=[])

    assert resolved[insp.id] is True
    assert insp.config.resolved_direction == "REVERSED"
    assert captured["auto_ids"] == set()


def test_mission_auto_with_inspection_inherit_triggers_solver(monkeypatch):
    """case (c) - inspection.direction is null and mission is AUTO -> solver is called."""
    from app.services.trajectory import heading_optimizer

    insp = _insp(direction=None, resolved="NATURAL")
    mission = _mission(direction="AUTO")

    captured = {}

    def fake_solve(inspections, surfaces, *, auto_ids, initial_reversed):
        """flip the auto inspection so we can verify the solver actually drives the result."""
        captured["auto_ids"] = set(auto_ids)
        return SimpleNamespace(
            assignments=[
                SimpleNamespace(inspection_id=i.id, reversed=True, is_auto=True)
                for i in inspections
            ]
        )

    monkeypatch.setattr(heading_optimizer, "solve_headings", fake_solve)

    resolved = _resolve_inspection_directions([insp], mission, surfaces=[])

    assert insp.id in captured["auto_ids"]
    assert resolved[insp.id] is True
    assert insp.config.resolved_direction == "REVERSED"
