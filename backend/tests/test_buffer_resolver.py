"""tests for the unified obstacle-buffer fallback chain.

covers the resolver itself, the orchestrator's final-assembled envelope policy
(`max(per-pass buffers used)`), and the constants/settings alias that ties
DEFAULT_BUFFER_DISTANCE_M to settings.vertex_buffer_m.
"""

from app.core.config import Settings, settings
from app.core.constants import DEFAULT_BUFFER_DISTANCE_M

# orchestrator final-assembled envelope policy


def test_compute_final_buffer_returns_max_of_per_pass():
    """final envelope is the max of all per-pass buffers actually used."""
    from app.services.trajectory.orchestrator import _compute_final_buffer

    assert _compute_final_buffer([2.0, 10.0, 4.5]) == 10.0


def test_compute_final_buffer_does_not_relax_below_largest_pass():
    """a smaller mission default cannot pull the final envelope below per-pass max."""
    from app.services.trajectory.orchestrator import _compute_final_buffer

    # passes used 10m; mission default would be 2m but it never enters the formula.
    assert _compute_final_buffer([10.0, 2.0]) == 10.0


def test_compute_final_buffer_empty_uses_settings_default():
    """no per-pass buffer captured (e.g. all inspections skipped) falls back to the seam."""
    from app.services.trajectory.orchestrator import _compute_final_buffer

    assert _compute_final_buffer([]) == settings.vertex_buffer_m


# vertex_buffer_m alias


def test_settings_vertex_buffer_aliases_default_constant():
    """vertex_buffer_m defaults to DEFAULT_BUFFER_DISTANCE_M so the two cannot drift."""
    s = Settings()
    assert s.vertex_buffer_m == DEFAULT_BUFFER_DISTANCE_M


def test_vertex_buffer_alias_overridable_via_env(monkeypatch):
    """env override still wins for the seam value."""
    monkeypatch.setenv("VERTEX_BUFFER_M", "12.5")
    s = Settings()
    assert s.vertex_buffer_m == 12.5


# inter-pass transit envelope wiring


def test_inter_pass_transit_pre_flight_uses_caller_buffer():
    """compute_inter_pass_transits' pre-flight applies the caller envelope, not
    just obs.buffer_distance.

    setup: an obstacle 5m above a transit endpoint with per-obstacle buffer=1m.
      - tight envelope (1m): pre-flight clears, transit succeeds.
      - wide envelope (10m): the larger buffer engulfs the endpoint and the
        pre-flight raises the distinguished keepout error.
    proves the orchestrator's final_buffer flows into the inter-pass call.
    """
    import pytest
    from shapely.geometry import Polygon

    from app.core.exceptions import TrajectoryGenerationError
    from app.services.trajectory.pathfinding import compute_inter_pass_transits
    from app.services.trajectory.types import (
        LocalGeometries,
        LocalObstacle,
        Point3D,
    )
    from app.utils.local_projection import LocalProjection

    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)

    # obstacle sits 5m off the transit endpoint at (100, 0)
    obstacle_polygon = Polygon([(99, 5), (101, 5), (101, 7), (99, 7)])
    obs = LocalObstacle(
        polygon=obstacle_polygon,
        name="near-endpoint",
        height=20.0,
        base_alt=0.0,
        buffer_distance=1.0,
    )
    geoms = LocalGeometries(
        proj=proj,
        obstacles=[obs],
        zones=[],
        boundary_zones=[],
        surfaces=[],
    )

    a_lon, a_lat = proj.to_wgs84(-100.0, 0.0)
    b_lon, b_lat = proj.to_wgs84(100.0, 0.0)
    c_lon, c_lat = proj.to_wgs84(300.0, 0.0)
    d_lon, d_lat = proj.to_wgs84(500.0, 0.0)
    a_start = Point3D(lon=a_lon, lat=a_lat, alt=100.0)
    a_end = Point3D(lon=b_lon, lat=b_lat, alt=100.0)
    b_start = Point3D(lon=c_lon, lat=c_lat, alt=100.0)
    b_end = Point3D(lon=d_lon, lat=d_lat, alt=100.0)

    # tight envelope: 1m buffer keeps the endpoint outside the keepout.
    transits, _ = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end)],
        geoms,
        speed=5.0,
        buffer_distance_override=1.0,
    )
    assert len(transits) == 1

    # wide envelope: 10m buffer pulls the keepout over the endpoint, pre-flight raises.
    with pytest.raises(TrajectoryGenerationError) as exc:
        compute_inter_pass_transits(
            [(a_start, a_end), (b_start, b_end)],
            geoms,
            speed=5.0,
            buffer_distance_override=10.0,
        )
    assert "endpoint inside obstacle keepout" in str(exc.value)


# orchestrator final-assembled validation block


def test_final_validation_error_names_effective_buffer():
    """orchestrator's final validate_inspection_pass block reports the effective buffer.

    setup mirrors orchestrator.py:1155-1170 with controlled inputs:
      - per-pass A uses small buffer X=2m and clears the obstacle.
      - per-pass B uses larger buffer Y=10m.
      - buffers_used=[X, Y] -> _compute_final_buffer returns Y.
      - final validate_inspection_pass on the assembled path with buffer_distance=Y
        engulfs a pass-A waypoint and produces a hard obstacle violation.
      - the raise replays the orchestrator's exact message format and must name Y,
        not X, so operators see which envelope was effective.
    """
    import pytest
    from shapely.geometry import Polygon

    from app.core.exceptions import TrajectoryGenerationError
    from app.services.trajectory.orchestrator import _compute_final_buffer
    from app.services.trajectory.safety_validator import validate_inspection_pass
    from app.services.trajectory.types import (
        LocalGeometries,
        LocalObstacle,
        WaypointData,
    )
    from app.utils.local_projection import LocalProjection

    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)

    # obstacle nearest corner ~4.24m from local origin; base 0m, top 20m.
    # buffer=2m -> origin outside; buffer=10m -> origin inside.
    obstacle_polygon = Polygon([(3, 3), (5, 3), (5, 5), (3, 5)])
    obs = LocalObstacle(
        polygon=obstacle_polygon,
        name="near-pass-A",
        height=20.0,
        base_alt=0.0,
        buffer_distance=0.0,
    )
    geoms = LocalGeometries(
        proj=proj,
        obstacles=[obs],
        zones=[],
        boundary_zones=[],
        surfaces=[],
    )

    # pass A waypoint sits at projection origin (clears at 2m, engulfed at 10m).
    a_lon, a_lat = proj.to_wgs84(0.0, 0.0)
    pass_a_wp = WaypointData(lon=a_lon, lat=a_lat, alt=10.0)

    # pass B waypoint sits well clear of the obstacle.
    b_lon, b_lat = proj.to_wgs84(500.0, 0.0)
    pass_b_wp = WaypointData(lon=b_lon, lat=b_lat, alt=10.0)

    x_buffer = 2.0
    y_buffer = 10.0

    # per-pass A clears at the small X buffer.
    per_pass_a = validate_inspection_pass(
        [pass_a_wp], drone=None, constraints=[], local_geoms=geoms, buffer_distance=x_buffer
    )
    assert not [v for v in per_pass_a if not v.is_warning], (
        "pass A should clear at the small per-pass buffer"
    )

    # per-pass B uses the larger Y buffer; its single waypoint is far from the obstacle.
    per_pass_b = validate_inspection_pass(
        [pass_b_wp], drone=None, constraints=[], local_geoms=geoms, buffer_distance=y_buffer
    )
    assert not [v for v in per_pass_b if not v.is_warning], (
        "pass B should clear at its own per-pass buffer"
    )

    # final envelope is max of per-pass buffers used.
    buffers_used = [x_buffer, y_buffer]
    final_buffer = _compute_final_buffer(buffers_used)
    assert final_buffer == y_buffer

    # replay the orchestrator's final validate_inspection_pass + raise block.
    all_waypoints = [pass_a_wp, pass_b_wp]
    final_violations = validate_inspection_pass(
        all_waypoints,
        drone=None,
        constraints=[],
        local_geoms=geoms,
        buffer_distance=final_buffer,
    )
    final_hard = [v for v in final_violations if not v.is_warning]
    assert final_hard, "final validation should hit a hard obstacle violation at buffer=Y"
    assert any(v.violation_kind == "obstacle" for v in final_hard)

    with pytest.raises(TrajectoryGenerationError) as exc:
        raise TrajectoryGenerationError(
            f"final validation failed (buffer={final_buffer:.1f} m)",
            violations=[
                {
                    "message": v.message,
                    "violation_kind": v.violation_kind,
                    "constraint_id": v.constraint_id,
                    "waypoint_index": v.waypoint_index,
                }
                for v in final_hard
            ],
        )

    # message names Y (the effective envelope), not X.
    assert str(exc.value) == f"final validation failed (buffer={y_buffer:.1f} m)"
    assert f"buffer={x_buffer:.1f}" not in str(exc.value)
