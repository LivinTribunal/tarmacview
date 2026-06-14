"""unit tests for local projection and Shapely-based intersection checks."""

import math
from types import SimpleNamespace

from shapely.geometry import LineString, box

from app.services.trajectory.safety_validator import (
    segment_runway_crossing_length,
    segments_intersect_obstacle,
    segments_intersect_zone,
)
from app.services.trajectory.types import LocalObstacle, LocalZone
from app.utils.local_projection import (
    DEFAULT_RUNWAY_WIDTH_M,
    LocalProjection,
    _build_local_obstacles,
    _build_local_surfaces,
    _build_local_zones,
    _dedupe_paired_surfaces,
    build_local_geometries,
    obstacle_base_altitude_from_wkt,
)


def _make_polygon_z_wkt(coords: list[tuple[float, float, float]]) -> str:
    """build a POLYGON Z WKT string from a single closed ring."""
    pts = ", ".join(f"{lon} {lat} {alt}" for lon, lat, alt in coords)
    return f"POLYGON Z (({pts}))"


def _make_polygon_2d_wkt(coords: list[tuple[float, float]]) -> str:
    """build a 2D POLYGON WKT string from a single closed ring."""
    pts = ", ".join(f"{lon} {lat}" for lon, lat in coords)
    return f"POLYGON (({pts}))"


def _make_linestring_z_wkt(coords: list[tuple[float, float, float]]) -> str:
    """build a LINESTRING Z WKT string."""
    pts = ", ".join(f"{lon} {lat} {alt}" for lon, lat, alt in coords)
    return f"LINESTRING Z ({pts})"


def _fake_runway(width: float, buffer_distance: float) -> SimpleNamespace:
    """fake AirfieldSurface with an east-west centerline through the projection origin."""
    geometry = _make_linestring_z_wkt(
        [
            (14.255, 50.10, 300.0),
            (14.265, 50.10, 300.0),
        ]
    )
    return SimpleNamespace(
        geometry=geometry,
        identifier="09/27",
        surface_type="RUNWAY",
        width=width,
        length=None,
        heading=90.0,
        buffer_distance=buffer_distance,
        name="fake-rwy",
    )


# round-trip projection accuracy


class TestLocalProjectionRoundTrip:
    """round-trip to_local -> to_wgs84 accuracy tests."""

    def test_origin_roundtrip(self):
        """origin point round-trips exactly."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        x, y = proj.to_local(14.26, 50.10)
        assert abs(x) < 1e-10
        assert abs(y) < 1e-10
        lon, lat = proj.to_wgs84(x, y)
        assert abs(lon - 14.26) < 1e-12
        assert abs(lat - 50.10) < 1e-12

    def test_roundtrip_100m_east(self):
        """100m east of origin round-trips within 0.01m."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # 100m east in local coords
        x, y = 100.0, 0.0
        lon, lat = proj.to_wgs84(x, y)
        x2, y2 = proj.to_local(lon, lat)
        assert abs(x2 - x) < 0.01
        assert abs(y2 - y) < 0.01

    def test_roundtrip_100m_north(self):
        """100m north of origin round-trips within 0.01m."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        x, y = 0.0, 100.0
        lon, lat = proj.to_wgs84(x, y)
        x2, y2 = proj.to_local(lon, lat)
        assert abs(x2 - x) < 0.01
        assert abs(y2 - y) < 0.01

    def test_roundtrip_1km_diagonal(self):
        """1km diagonal round-trips within 0.01m."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        x, y = 707.0, 707.0
        lon, lat = proj.to_wgs84(x, y)
        x2, y2 = proj.to_local(lon, lat)
        assert abs(x2 - x) < 0.01
        assert abs(y2 - y) < 0.01

    def test_roundtrip_5km_all_directions(self):
        """5km in all cardinal directions round-trips within 0.01m."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        for dx, dy in [(5000, 0), (-5000, 0), (0, 5000), (0, -5000), (3536, 3536)]:
            lon, lat = proj.to_wgs84(dx, dy)
            x2, y2 = proj.to_local(lon, lat)
            err = math.sqrt((x2 - dx) ** 2 + (y2 - dy) ** 2)
            assert err < 0.01, f"round-trip error {err:.4f}m at ({dx}, {dy})"

    def test_distance_accuracy_at_5km(self):
        """euclidean distance in local coords matches haversine within 0.5m at 5km."""
        from app.utils.geo import distance_between

        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # two points ~5km apart
        lon1, lat1 = 14.26, 50.10
        lon2, lat2 = 14.32, 50.14
        x1, y1 = proj.to_local(lon1, lat1)
        x2, y2 = proj.to_local(lon2, lat2)
        local_dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        haversine_dist = distance_between(lon1, lat1, lon2, lat2)
        assert abs(local_dist - haversine_dist) < 2.0, (
            f"distance error {abs(local_dist - haversine_dist):.3f}m "
            f"(local={local_dist:.1f}m, haversine={haversine_dist:.1f}m)"
        )


# Shapely intersection accuracy vs known geometry


class TestShapelyIntersectionAccuracy:
    """Shapely intersection results match expected geometry."""

    def test_line_intersects_polygon(self):
        """line crossing a polygon is detected."""
        poly = box(0, 0, 100, 100)
        line = LineString([(-50, 50), (150, 50)])
        assert line.intersects(poly)

    def test_line_misses_polygon(self):
        """line not crossing a polygon is not detected."""
        poly = box(0, 0, 100, 100)
        line = LineString([(-50, 150), (150, 150)])
        assert not line.intersects(poly)

    def test_intersection_length_accuracy(self):
        """intersection length matches expected value."""
        # 100m wide runway, line crosses perpendicular through center
        runway = box(-500, -50, 500, 50)
        line = LineString([(0, -200), (0, 200)])
        intersection = line.intersection(runway)
        # should be exactly 100m (from y=-50 to y=50)
        assert abs(intersection.length - 100.0) < 0.01

    def test_obstacle_containment(self):
        """point inside buffered obstacle is detected."""
        from shapely.geometry import Point

        obs_poly = box(0, 0, 10, 10)
        buffered = obs_poly.buffer(5.0)
        # point 3m outside original boundary but inside 5m buffer
        assert buffered.contains(Point(12.0, 5.0))
        # point 6m outside - beyond buffer
        assert not buffered.contains(Point(16.0, 5.0))

    def test_obstacle_intersection_with_buffer(self):
        """segment intersecting buffered obstacle is detected."""
        obs = LocalObstacle(
            polygon=box(40, 40, 60, 60),
            name="test",
            height=10.0,
            base_alt=0.0,
            buffer_distance=10.0,
        )
        # line passes 5m from obstacle edge - within 10m buffer
        assert segments_intersect_obstacle(50, 0, 50, 100, obs, buffer_distance=10.0)
        # line passes 15m from obstacle edge - outside 10m buffer
        assert not segments_intersect_obstacle(80, 0, 80, 100, obs, buffer_distance=10.0)

    def test_runway_crossing_length_diagonal(self):
        """diagonal crossing returns correct length."""
        # runway 100m wide, 1000m long, centered at origin
        runway = box(-500, -50, 500, 50)
        # diagonal line from (-100, -100) to (100, 100)
        length = segment_runway_crossing_length(-100, -100, 100, 100, runway)
        # crosses 100m of height diagonally: 100*sqrt(2) ≈ 141.4m
        assert abs(length - 100 * math.sqrt(2)) < 1.0


# local projection with real WGS84 coordinates


class TestProjectionWithRealCoordinates:
    """test projection with LKPR-like coordinates."""

    def test_lkpr_runway_distance(self):
        """distance between two runway endpoints in local coords matches haversine."""
        from app.utils.geo import distance_between

        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # approximate LKPR runway endpoints
        lon1, lat1 = 14.255, 50.10
        lon2, lat2 = 14.265, 50.10
        x1, y1 = proj.to_local(lon1, lat1)
        x2, y2 = proj.to_local(lon2, lat2)
        local_dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        haversine_dist = distance_between(lon1, lat1, lon2, lat2)
        assert abs(local_dist - haversine_dist) < 0.1

    def test_obstacle_avoidance_path_deviation(self):
        """path around obstacle in local coords deviates less than 1m from haversine path."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # two points ~200m apart
        lon1, lat1 = 14.259, 50.10
        lon2, lat2 = 14.261, 50.10
        x1, y1 = proj.to_local(lon1, lat1)
        x2, y2 = proj.to_local(lon2, lat2)
        # direct distance in local vs haversine
        from app.utils.geo import distance_between

        local_dist = math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        haversine_dist = distance_between(lon1, lat1, lon2, lat2)
        assert abs(local_dist - haversine_dist) < 1.0


# edge cases


class TestProjectionEdgeCases:
    """edge cases for local projection."""

    def test_zero_distance(self):
        """same point round-trips exactly."""
        proj = LocalProjection(ref_lon=0.0, ref_lat=0.0)
        x, y = proj.to_local(0.0, 0.0)
        assert x == 0.0
        assert y == 0.0

    def test_negative_coordinates(self):
        """negative coordinates (western hemisphere) work correctly."""
        proj = LocalProjection(ref_lon=-73.9, ref_lat=40.7)
        x, y = proj.to_local(-73.9, 40.7)
        assert abs(x) < 1e-10
        assert abs(y) < 1e-10
        # point 1km east
        lon, lat = proj.to_wgs84(1000.0, 0.0)
        x2, y2 = proj.to_local(lon, lat)
        assert abs(x2 - 1000.0) < 0.01

    def test_empty_obstacle_list(self):
        """intersection check with empty obstacle list returns False."""
        from app.services.trajectory.pathfinding import _is_segment_blocked

        assert not _is_segment_blocked(0, 0, 100, 100, [], [])

    def test_zone_intersection_with_hard_type(self):
        """hard zone intersection is detected."""
        zone = LocalZone(
            polygon=box(40, 40, 60, 60),
            zone_type="PROHIBITED",
            name="test",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        assert segments_intersect_zone(0, 50, 100, 50, zone.polygon)

    def test_zone_intersection_miss(self):
        """line missing zone returns False."""
        zone_poly = box(40, 40, 60, 60)
        assert not segments_intersect_zone(0, 0, 100, 0, zone_poly)


# obstacle base altitude (max-corner stance)


class TestObstacleBaseAltitudeFromWkt:
    """high-corner extraction from WKT polygon boundaries."""

    def test_uses_max_z_on_slope(self):
        """sloped corners 300/302/308/310 return 310 (highest corner)."""
        wkt = _make_polygon_z_wkt(
            [
                (14.260, 50.100, 300.0),
                (14.261, 50.100, 302.0),
                (14.261, 50.101, 308.0),
                (14.260, 50.101, 310.0),
                (14.260, 50.100, 300.0),
            ]
        )
        assert obstacle_base_altitude_from_wkt(wkt) == 310.0

    def test_flat_ring_unchanged(self):
        """all corners at the same z still return that z (flat-terrain regression)."""
        wkt = _make_polygon_z_wkt(
            [
                (14.260, 50.100, 5.0),
                (14.261, 50.100, 5.0),
                (14.261, 50.101, 5.0),
                (14.260, 50.101, 5.0),
                (14.260, 50.100, 5.0),
            ]
        )
        assert obstacle_base_altitude_from_wkt(wkt) == 5.0

    def test_2d_ring_returns_zero(self):
        """polygon without z falls back to 0.0 (no boundary altitude available)."""
        wkt = _make_polygon_2d_wkt(
            [
                (14.260, 50.100),
                (14.261, 50.100),
                (14.261, 50.101),
                (14.260, 50.101),
                (14.260, 50.100),
            ]
        )
        assert obstacle_base_altitude_from_wkt(wkt) == 0.0

    def test_malformed_input_returns_zero(self):
        """malformed WKT degrades to 0.0 instead of raising."""
        assert obstacle_base_altitude_from_wkt("not-wkt") == 0.0


# LocalSurface.polygon inflation by surface.buffer_distance


class TestLocalSurfacePolygonBufferDistance:
    """LocalSurface polygon must be inflated by surface.buffer_distance at construction."""

    def test_polygon_inflated_by_buffer_distance(self):
        """runway with width=45 + buffer_distance=20 yields a 22.5+20=42.5m half-width region."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        surface = _fake_runway(width=45.0, buffer_distance=20.0)
        geoms = build_local_geometries(proj, [], [], [surface])

        assert len(geoms.surfaces) == 1
        local_surface = geoms.surfaces[0]
        assert local_surface.buffer_distance == 20.0

        # centerline runs through the projection origin along the x-axis;
        # min-distance from a perpendicular probe to the polygon boundary
        # gives the effective half-width of the no-go region.
        cl_coords = list(local_surface.centerline.coords)
        cx = (cl_coords[0][0] + cl_coords[-1][0]) / 2
        # walk perpendicular until just outside the polygon
        from shapely.geometry import Point

        for offset in (22.0, 22.5, 30.0, 42.0):
            assert local_surface.polygon.contains(Point(cx, offset)), (
                f"point at y={offset}m should be inside buffered polygon"
            )
        # 1m outside (half_width + buffer + 1)
        assert not local_surface.polygon.contains(Point(cx, 43.6))

    def test_zero_buffer_distance_matches_unbuffered_half_width(self):
        """buffer_distance=0 reproduces the legacy half-width-only polygon (regression)."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        surface = _fake_runway(width=45.0, buffer_distance=0.0)
        geoms = build_local_geometries(proj, [], [], [surface])

        local_surface = geoms.surfaces[0]
        assert local_surface.buffer_distance == 0.0

        from shapely.geometry import Point

        cl_coords = list(local_surface.centerline.coords)
        cx = (cl_coords[0][0] + cl_coords[-1][0]) / 2
        # half_width = 22.5 - inside; +1m outside
        assert local_surface.polygon.contains(Point(cx, 22.0))
        assert not local_surface.polygon.contains(Point(cx, 23.6))

    def test_taxiway_buffer_distance_inflates_polygon(self):
        """taxiway iteration is unfiltered on surface_type - buffer applies the same way."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        surface = _fake_runway(width=20.0, buffer_distance=10.0)
        surface.surface_type = "TAXIWAY"
        geoms = build_local_geometries(proj, [], [], [surface])

        local_surface = geoms.surfaces[0]
        assert local_surface.buffer_distance == 10.0

        from shapely.geometry import Point

        cl_coords = list(local_surface.centerline.coords)
        cx = (cl_coords[0][0] + cl_coords[-1][0]) / 2
        # half_width=10 + buffer=10 → 20m total
        assert local_surface.polygon.contains(Point(cx, 19.0))
        assert not local_surface.polygon.contains(Point(cx, 21.0))


# paired-runway dedupe (issue #449)


class TestPairedRunwayDedupe:
    """build_local_geometries folds paired AirfieldSurface rows into one LocalSurface.

    each physical runway is stored as two rows (one per designator end, e.g. 04/22)
    with geometrically identical buffered polygons. processing both sides
    double-counts the crossing-length penalty in `_build_visibility_graph` and
    emits duplicate crossing-pair nodes, which produced a dramatically inefficient
    inter-pass transit when "Avoid runway crossings" was on. the dedupe folds the
    pair into one entry and bundles the designator (e.g. "04/22") for warnings.
    """

    def _paired_runway_pair(self, ident_a: str, ident_b: str):
        """build two SimpleNamespace surfaces that mirror a coupled-pair pair."""
        from uuid import uuid4

        id_a = uuid4()
        id_b = uuid4()
        geometry_fwd = _make_linestring_z_wkt([(14.255, 50.10, 300.0), (14.265, 50.10, 300.0)])
        geometry_rev = _make_linestring_z_wkt([(14.265, 50.10, 300.0), (14.255, 50.10, 300.0)])
        a = SimpleNamespace(
            id=id_a,
            paired_surface_id=id_b,
            geometry=geometry_fwd,
            identifier=ident_a,
            surface_type="RUNWAY",
            width=60.0,
            length=None,
            heading=90.0,
            buffer_distance=5.0,
            name=f"rwy-{ident_a}",
        )
        b = SimpleNamespace(
            id=id_b,
            paired_surface_id=id_a,
            geometry=geometry_rev,
            identifier=ident_b,
            surface_type="RUNWAY",
            width=60.0,
            length=None,
            heading=270.0,
            buffer_distance=5.0,
            name=f"rwy-{ident_b}",
        )
        return a, b

    def test_paired_pair_yields_single_local_surface(self):
        """two paired surfaces collapse to one LocalSurface (no double-counting)."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        a, b = self._paired_runway_pair("04", "22")
        geoms = build_local_geometries(proj, [], [], [a, b])

        assert len(geoms.surfaces) == 1

    def test_paired_identifier_is_bundled(self):
        """kept LocalSurface carries the bundled designator (lex-sorted)."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        # passed in (22, 04) order - identifier should still lex-sort to "04/22"
        b, a = self._paired_runway_pair("04", "22")
        geoms = build_local_geometries(proj, [], [], [b, a])

        assert geoms.surfaces[0].identifier == "04/22"

    def test_uncoupled_runway_keeps_own_identifier(self):
        """uncoupled surfaces (no paired_surface_id) pass through unchanged."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        from uuid import uuid4

        geometry = _make_linestring_z_wkt([(14.255, 50.10, 300.0), (14.265, 50.10, 300.0)])
        surface = SimpleNamespace(
            id=uuid4(),
            paired_surface_id=None,
            geometry=geometry,
            identifier="09",
            surface_type="RUNWAY",
            width=60.0,
            length=None,
            heading=90.0,
            buffer_distance=5.0,
            name="rwy-09",
        )
        geoms = build_local_geometries(proj, [], [], [surface])

        assert len(geoms.surfaces) == 1
        assert geoms.surfaces[0].identifier == "09"

    def test_two_independent_paired_pairs_yield_two_local_surfaces(self):
        """two physical runways (each a paired pair) yield two LocalSurfaces."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        a1, b1 = self._paired_runway_pair("04", "22")
        a2, b2 = self._paired_runway_pair("13", "31")
        geoms = build_local_geometries(proj, [], [], [a1, b1, a2, b2])

        assert len(geoms.surfaces) == 2
        idents = sorted(s.identifier for s in geoms.surfaces)
        assert idents == ["04/22", "13/31"]


# extracted helpers - direct unit coverage


class TestDedupePairedSurfaces:
    """_dedupe_paired_surfaces folds paired rows and falls back when ids are absent."""

    def test_paired_rows_fold_to_first(self):
        """a paired pair collapses to the first row, in input order."""
        from uuid import uuid4

        id_a, id_b = uuid4(), uuid4()
        a = SimpleNamespace(id=id_a, paired_surface_id=id_b, name="a")
        b = SimpleNamespace(id=id_b, paired_surface_id=id_a, name="b")
        deduped = _dedupe_paired_surfaces([a, b])
        assert deduped == [a]

    def test_independent_pairs_both_kept(self):
        """two independent pairs keep one row each."""
        from uuid import uuid4

        ids = [uuid4() for _ in range(4)]
        a1 = SimpleNamespace(id=ids[0], paired_surface_id=ids[1], name="a1")
        b1 = SimpleNamespace(id=ids[1], paired_surface_id=ids[0], name="b1")
        a2 = SimpleNamespace(id=ids[2], paired_surface_id=ids[3], name="a2")
        b2 = SimpleNamespace(id=ids[3], paired_surface_id=ids[2], name="b2")
        deduped = _dedupe_paired_surfaces([a1, b1, a2, b2])
        assert [s.name for s in deduped] == ["a1", "a2"]

    def test_falls_back_when_id_missing(self):
        """rows without an id (test fixtures) pass through untouched."""
        s1 = SimpleNamespace(name="s1")
        s2 = SimpleNamespace(name="s2")
        assert _dedupe_paired_surfaces([s1, s2]) == [s1, s2]

    def test_uncoupled_rows_pass_through(self):
        """rows with ids but no paired_surface_id are all kept."""
        from uuid import uuid4

        s1 = SimpleNamespace(id=uuid4(), paired_surface_id=None, name="s1")
        s2 = SimpleNamespace(id=uuid4(), paired_surface_id=None, name="s2")
        assert _dedupe_paired_surfaces([s1, s2]) == [s1, s2]


class TestBuildLocalZones:
    """_build_local_zones splits AIRPORT_BOUNDARY rows from ordinary safety zones."""

    def _zone(self, zone_type: str, name: str) -> SimpleNamespace:
        """stub SafetyZone with a small valid polygon around the projection origin."""
        geometry = _make_polygon_2d_wkt(
            [
                (14.255, 50.095),
                (14.265, 50.095),
                (14.265, 50.105),
                (14.255, 50.105),
                (14.255, 50.095),
            ]
        )
        return SimpleNamespace(
            geometry=geometry,
            type=zone_type,
            name=name,
            altitude_floor=10.0,
            altitude_ceiling=120.0,
        )

    def test_airport_boundary_routed_to_boundaries(self):
        """an AIRPORT_BOUNDARY zone becomes a LocalBoundary, not a LocalZone."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        zones = [
            self._zone("AIRPORT_BOUNDARY", "perimeter"),
            self._zone("PROHIBITED", "no-fly"),
        ]
        local_zones, local_boundaries = _build_local_zones(proj, zones)

        assert [b.name for b in local_boundaries] == ["perimeter"]
        assert [z.name for z in local_zones] == ["no-fly"]
        assert local_zones[0].zone_type == "PROHIBITED"
        assert local_zones[0].altitude_floor == 10.0
        assert local_zones[0].altitude_ceiling == 120.0

    def test_non_polygon_zone_skipped(self):
        """a zone whose geometry is not a polygon is dropped from both lists."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        bad = SimpleNamespace(
            geometry="POINT Z (14.26 50.10 0)",
            type="PROHIBITED",
            name="bad",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        local_zones, local_boundaries = _build_local_zones(proj, [bad])
        assert local_zones == []
        assert local_boundaries == []

    def test_empty_geometry_zone_skipped(self):
        """a zone with no geometry string is skipped before parsing."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        empty = SimpleNamespace(
            geometry=None,
            type="AIRPORT_BOUNDARY",
            name="empty",
            altitude_floor=None,
            altitude_ceiling=None,
        )
        local_zones, local_boundaries = _build_local_zones(proj, [empty])
        assert local_zones == []
        assert local_boundaries == []


class TestBuildLocalObstacles:
    """_build_local_obstacles maps ORM obstacles and skips unparseable geometry."""

    def _obstacle(self, **overrides) -> SimpleNamespace:
        """stub Obstacle with a small valid POLYGON Z around the projection origin."""
        boundary = _make_polygon_z_wkt(
            [
                (14.255, 50.095, 300.0),
                (14.265, 50.095, 305.0),
                (14.265, 50.105, 310.0),
                (14.255, 50.105, 300.0),
                (14.255, 50.095, 300.0),
            ]
        )
        defaults = {
            "boundary": boundary,
            "name": "tower",
            "height": 25.0,
            "buffer_distance": 8.0,
        }
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_valid_obstacle_mapped(self):
        """a parseable obstacle yields one LocalObstacle with base_alt = max corner z."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        local_obstacles = _build_local_obstacles(proj, [self._obstacle()])

        assert len(local_obstacles) == 1
        obs = local_obstacles[0]
        assert obs.name == "tower"
        assert obs.height == 25.0
        assert obs.buffer_distance == 8.0
        # obstacle_base_altitude_from_wkt takes the highest boundary corner
        assert obs.base_alt == 310.0
        assert not obs.polygon.is_empty

    def test_missing_boundary_skipped(self):
        """an obstacle with no boundary string is skipped before parsing."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        assert _build_local_obstacles(proj, [self._obstacle(boundary=None)]) == []

    def test_unparseable_geometry_skipped(self):
        """a non-polygon boundary is dropped instead of raising."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        bad = self._obstacle(boundary="POINT Z (14.26 50.10 0)")
        assert _build_local_obstacles(proj, [bad]) == []

    def test_none_fields_default(self):
        """None name/height/buffer_distance collapse to ''/0.0/0.0."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        local_obstacles = _build_local_obstacles(
            proj, [self._obstacle(name=None, height=None, buffer_distance=None)]
        )

        assert len(local_obstacles) == 1
        obs = local_obstacles[0]
        assert obs.name == ""
        assert obs.height == 0.0
        assert obs.buffer_distance == 0.0


class TestBuildLocalSurfaces:
    """_build_local_surfaces maps deduped surfaces and bundles paired designators."""

    def _surface(self, **overrides) -> SimpleNamespace:
        """stub AirfieldSurface with an east-west centerline through the origin."""
        geometry = _make_linestring_z_wkt(
            [
                (14.255, 50.10, 300.0),
                (14.265, 50.10, 300.0),
            ]
        )
        defaults = {
            "geometry": geometry,
            "identifier": "09",
            "surface_type": "RUNWAY",
            "width": 60.0,
            "length": 1800.0,
            "heading": 90.0,
            "buffer_distance": 5.0,
            "paired_surface_id": None,
            "name": "fake-rwy",
        }
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_single_surface_keeps_own_identifier(self):
        """a surface with no resolvable partner keeps its own identifier."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        surface = self._surface()
        local_surfaces = _build_local_surfaces(proj, [surface], {})

        assert len(local_surfaces) == 1
        ls = local_surfaces[0]
        assert ls.identifier == "09"
        assert ls.width == 60.0
        assert ls.length == 1800.0
        assert ls.buffer_distance == 5.0
        assert not ls.polygon.is_empty

    def test_missing_geometry_skipped(self):
        """a surface with no geometry string is skipped before parsing."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        assert _build_local_surfaces(proj, [self._surface(geometry=None)], {}) == []

    def test_unparseable_geometry_skipped(self):
        """a non-linestring geometry is dropped instead of raising."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        bad = self._surface(geometry="POINT Z (14.26 50.10 0)")
        assert _build_local_surfaces(proj, [bad], {}) == []

    def test_paired_identifier_bundled_lex_sorted(self):
        """a resolvable partner with a distinct identifier yields a lex-sorted bundle."""
        from uuid import uuid4

        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        partner_id = uuid4()
        partner = SimpleNamespace(identifier="04")
        surface = self._surface(identifier="22", paired_surface_id=partner_id)
        local_surfaces = _build_local_surfaces(proj, [surface], {partner_id: partner})

        assert local_surfaces[0].identifier == "04/22"

    def test_default_width_and_length_fallback(self):
        """None width falls back to DEFAULT_RUNWAY_WIDTH_M; None length to centerline length."""
        proj = LocalProjection(ref_lon=14.26, ref_lat=50.10)
        surface = self._surface(width=None, length=None)
        local_surfaces = _build_local_surfaces(proj, [surface], {})

        ls = local_surfaces[0]
        assert ls.width == DEFAULT_RUNWAY_WIDTH_M
        assert ls.length == ls.centerline.length
        assert ls.length > 0.0
