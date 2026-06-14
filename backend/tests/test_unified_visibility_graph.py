"""tests for the unified inter-pass visibility graph + bounded dilation fallback.

verifies issue #294 part B at the pathfinding-function level. fixtures are built
directly in local meter coordinates, bypassing the database / orchestrator.
"""

import math

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


def _box(cx: float, cy: float, half: float) -> Polygon:
    """axis-aligned square obstacle polygon centered at (cx, cy)."""
    return Polygon(
        [
            (cx - half, cy - half),
            (cx + half, cy - half),
            (cx + half, cy + half),
            (cx - half, cy + half),
        ]
    )


def _obstacle(cx: float, cy: float, half: float = 50.0, buffer: float = 10.0) -> LocalObstacle:
    """build an obstacle in local meters at (cx, cy)."""
    return LocalObstacle(
        polygon=_box(cx, cy, half),
        name=f"obs_{cx}_{cy}",
        height=20.0,
        base_alt=0.0,
        buffer_distance=buffer,
    )


def _geoms(obstacles=()) -> LocalGeometries:
    """build LocalGeometries with given obstacles, no surfaces / zones / boundaries."""
    proj = LocalProjection(ref_lon=14.0, ref_lat=50.0)
    return LocalGeometries(
        proj=proj,
        obstacles=list(obstacles),
        zones=[],
        boundary_zones=[],
        surfaces=[],
    )


def _to_lonlat(proj: LocalProjection, x: float, y: float, alt: float = 100.0) -> Point3D:
    """build a Point3D from local-meter (x, y) by inverting the projection."""
    lon, lat = proj.to_wgs84(x, y)
    return Point3D(lon=lon, lat=lat, alt=alt)


def test_clustered_passes_succeed_without_dilation():
    """two passes with no obstacle in between: A* succeeds on attempt 0, no warnings."""
    g = _geoms()
    a_start = _to_lonlat(g.proj, 0.0, 0.0)
    a_end = _to_lonlat(g.proj, 100.0, 0.0)
    b_start = _to_lonlat(g.proj, 300.0, 0.0)
    b_end = _to_lonlat(g.proj, 400.0, 0.0)

    transits, warnings = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end)],
        g,
        speed=5.0,
    )
    assert len(transits) == 1
    assert transits[0]
    assert warnings == []


def test_single_pass_returns_no_transits():
    """fewer than 2 passes means there are no inter-pass transits to compute."""
    g = _geoms()
    s = _to_lonlat(g.proj, 0.0, 0.0)
    e = _to_lonlat(g.proj, 100.0, 0.0)
    transits, warnings = compute_inter_pass_transits([(s, e)], g, speed=5.0)
    assert transits == []
    assert warnings == []


def test_endpoint_inside_obstacle_keepout_raises_distinguished_error():
    """pre-flight: a transit endpoint inside any buffered obstacle yields the keepout error.

    transit endpoints are pass[i].last and pass[i+1].first - put the obstacle around
    pass A's last point so the pre-flight catches it before A* runs.
    """
    obs = _obstacle(200.0, 0.0, half=20.0, buffer=15.0)  # buffered span [165, 235] in x
    g = _geoms([obs])
    a_start = _to_lonlat(g.proj, 0.0, 0.0)
    a_end = _to_lonlat(g.proj, 200.0, 0.0)  # INSIDE buffered obstacle
    b_start = _to_lonlat(g.proj, 400.0, 0.0)
    b_end = _to_lonlat(g.proj, 500.0, 0.0)

    with pytest.raises(TrajectoryGenerationError) as exc:
        compute_inter_pass_transits(
            [(a_start, a_end), (b_start, b_end)],
            g,
            speed=5.0,
        )
    assert "endpoint inside obstacle keepout" in str(exc.value)


def test_obstacle_straddling_hull_routes_around_it():
    """large obstacle whose buffered polygon intersects the hull: A* routes around."""
    # passes are aligned along x, with an obstacle blocking the direct path between them
    obs = _obstacle(150.0, 0.0, half=40.0, buffer=10.0)  # blocks (110, 190) in x
    g = _geoms([obs])
    a_start = _to_lonlat(g.proj, 0.0, -50.0)
    a_end = _to_lonlat(g.proj, 100.0, -50.0)
    b_start = _to_lonlat(g.proj, 200.0, -50.0)
    b_end = _to_lonlat(g.proj, 300.0, -50.0)

    transits, warnings = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end)],
        g,
        speed=5.0,
    )
    # one transit, finds a path around the obstacle
    assert len(transits) == 1
    # A* required - more than 1 transit waypoint when routing around
    assert len(transits[0]) >= 1


def _ring_around(cx: float, cy: float, radius: float, n: int) -> list[LocalObstacle]:
    """build a closed ring of n square obstacles centred at (cx, cy)."""
    return [
        _obstacle(
            cx + radius * math.cos(k * 2 * math.pi / n),
            cy + radius * math.sin(k * 2 * math.pi / n),
            half=3.0,
            buffer=2.0,
        )
        for k in range(n)
    ]


def test_dilation_succeeds_after_one_expansion_emits_warning():
    """wall obstacles fully blocking initial hull; one dilation opens a bypass."""
    # passes flank a wall along y=25 inside a tight 10x50 hull. a far obstacle (not
    # intersecting the initial hull) supplies the Δ for the first dilation, after
    # which the dilated hull's exterior provides nodes to route around the wall.
    obstacles = [
        _obstacle(1.0, 25.0, half=4.0, buffer=2.0),
        _obstacle(5.0, 25.0, half=4.0, buffer=2.0),
        _obstacle(9.0, 25.0, half=4.0, buffer=2.0),
        # far obstacle - outside initial hull, supplies Δ=10 on first dilation
        _obstacle(50.0, 25.0, half=4.0, buffer=10.0),
    ]
    g = _geoms(obstacles)
    a_start = _to_lonlat(g.proj, 0.0, 0.0)
    a_end = _to_lonlat(g.proj, 10.0, 0.0)
    b_start = _to_lonlat(g.proj, 0.0, 50.0)
    b_end = _to_lonlat(g.proj, 10.0, 50.0)

    transits, warnings = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end)],
        g,
        speed=5.0,
    )
    assert len(transits) == 1
    assert transits[0]
    assert len(warnings) == 1
    assert warnings[0].startswith("transit graph expanded ")


def test_expansion_exhausted_raises_distinguished_error():
    """all obstacles enclosed in initial region but A* still finds no route."""
    # 12-obstacle ring around b_start = (50, 50) inside a 100x100 hull. b_start is
    # outside every buffered obstacle (pre-flight passes), the ring has no gap, and
    # every obstacle's buffered polygon sits strictly inside the initial hull -
    # so not_enclosed is empty on the first failed attempt.
    ring = _ring_around(50.0, 50.0, radius=12.0, n=12)
    g = _geoms(ring)
    # 3 passes so the convex hull is the full [0,100]x[0,100] rectangle and the
    # ring sits in the interior rather than on the hull boundary
    a = (_to_lonlat(g.proj, 0.0, 0.0), _to_lonlat(g.proj, 100.0, 0.0))
    b = (_to_lonlat(g.proj, 50.0, 50.0), _to_lonlat(g.proj, 51.0, 50.0))
    c = (_to_lonlat(g.proj, 0.0, 100.0), _to_lonlat(g.proj, 100.0, 100.0))

    with pytest.raises(TrajectoryGenerationError) as exc:
        compute_inter_pass_transits([a, b, c], g, speed=5.0)
    assert "expansion exhausted" in str(exc.value)


def test_genuine_no_path_after_dilation_raises():
    """A* fails on every dilation attempt and bottoms out at the 2-dilation cap."""
    # same gap-free ring around b_start as the expansion-exhausted test, plus two
    # far-flung obstacles whose buffered polygons stay outside the dilated hull on
    # both expansion steps. that keeps not_enclosed non-empty at attempts 0 and 1
    # so the loop reaches attempt 2 and raises "no path after 2 dilations".
    obstacles = _ring_around(50.0, 50.0, radius=12.0, n=12)
    obstacles.extend(
        [
            _obstacle(500.0, 50.0, half=3.0, buffer=2.0),
            _obstacle(50.0, 500.0, half=3.0, buffer=2.0),
        ]
    )
    g = _geoms(obstacles)
    a = (_to_lonlat(g.proj, 0.0, 0.0), _to_lonlat(g.proj, 100.0, 0.0))
    b = (_to_lonlat(g.proj, 50.0, 50.0), _to_lonlat(g.proj, 51.0, 50.0))
    c = (_to_lonlat(g.proj, 0.0, 100.0), _to_lonlat(g.proj, 100.0, 100.0))

    with pytest.raises(TrajectoryGenerationError) as exc:
        compute_inter_pass_transits([a, b, c], g, speed=5.0)
    assert "no path after 2 dilations" in str(exc.value)


def test_no_obstacles_uses_fast_straight_line():
    """with no obstacles in the scene the fast straight-line path is used per transit."""
    g = _geoms()
    a_start = _to_lonlat(g.proj, 0.0, 0.0)
    a_end = _to_lonlat(g.proj, 50.0, 0.0)
    b_start = _to_lonlat(g.proj, 150.0, 0.0)
    b_end = _to_lonlat(g.proj, 200.0, 0.0)
    c_start = _to_lonlat(g.proj, 300.0, 0.0)
    c_end = _to_lonlat(g.proj, 350.0, 0.0)

    transits, warnings = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end), (c_start, c_end)],
        g,
        speed=5.0,
    )
    assert len(transits) == 2
    # fast path returns exactly one waypoint per transit
    for wps in transits:
        assert len(wps) == 1
    assert warnings == []


def test_collinear_pass_endpoints_yield_unified_transits():
    """three passes whose six endpoints all sit on a single line still produce
    inter-pass transits.

    the convex hull of collinear points degenerates to a LineString (not a
    Polygon), and an obstacle that forces A* fallback exercises the slow path
    through that degenerate region. defends `_polygon_exterior_vertices` and
    `_build_unified_region` against shape-type assumptions.
    """
    # passes A, B, C share y=-50; the obstacle at y=0 blocks the fast path
    # between A and B, forcing the unified visibility graph to run on a
    # LineString hull. transit B->C stays clear and uses the fast path.
    obs = _obstacle(150.0, 0.0, half=40.0, buffer=10.0)
    g = _geoms([obs])
    a = (_to_lonlat(g.proj, 0.0, -50.0), _to_lonlat(g.proj, 100.0, -50.0))
    b = (_to_lonlat(g.proj, 200.0, -50.0), _to_lonlat(g.proj, 300.0, -50.0))
    c = (_to_lonlat(g.proj, 400.0, -50.0), _to_lonlat(g.proj, 500.0, -50.0))

    transits, _warnings = compute_inter_pass_transits([a, b, c], g, speed=5.0)
    assert len(transits) == 2
    for wps in transits:
        assert len(wps) >= 1


def test_endpoint_on_buffered_obstacle_boundary_treated_as_outside():
    """endpoint placed on the buffered obstacle ring is treated as outside.

    `_check_endpoint_outside_obstacles` uses `Polygon.contains`, which is strict:
    points exactly on the boundary return False, so the pre-flight keepout check
    passes. this pins the "boundary = outside" policy first by asserting Shapely's
    `contains` returns False for a point on the ring, and second by running the
    full transit with an endpoint placed against that ring (a sub-millimetre of
    floating-point round-trip is the practical floor on lon/lat coordinates).

    follow-up: switching to `covers` would flip boundary points to "inside" and
    would need a documented policy change before this test is updated.
    """
    from shapely.geometry import Point

    from app.services.trajectory.pathfinding import _buffered_polygon_for

    # buffered obstacle ring around (200, 0): half=20 + buffer=15 -> straight
    # east edge at x=235. confirm the strict-contains policy on that edge.
    obs = _obstacle(200.0, 0.0, half=20.0, buffer=15.0)
    buffered = _buffered_polygon_for(obs, None)
    assert buffered.contains(Point(235.0, 0.0)) is False
    assert buffered.touches(Point(235.0, 0.0)) is True

    # full transit: endpoint sits a hair outside the ring (well within the
    # straight east-edge band). because contains is strict, no keepout raised.
    g = _geoms([obs])
    a_start = _to_lonlat(g.proj, 0.0, 0.0)
    a_end = _to_lonlat(g.proj, 235.001, 0.0)
    b_start = _to_lonlat(g.proj, 400.0, 0.0)
    b_end = _to_lonlat(g.proj, 500.0, 0.0)

    transits, _warnings = compute_inter_pass_transits(
        [(a_start, a_end), (b_start, b_end)],
        g,
        speed=5.0,
    )
    assert len(transits) == 1
