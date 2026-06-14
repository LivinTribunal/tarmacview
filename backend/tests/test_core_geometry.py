"""tests for app.core.geometry public helpers."""

import pytest
from shapely.errors import ShapelyError

from app.core.geometry import (
    linestring_xy,
    point_lonlatalt,
    polygon_xy,
    wkt_to_geojson,
    wkt_to_shapely,
)


class TestPointLonLatAlt:
    """tests for point_lonlatalt."""

    def test_point_z_returns_three_floats(self):
        """3-D point WKT yields (lon, lat, alt) floats."""
        assert point_lonlatalt("POINT Z (10 20 30)") == (10.0, 20.0, 30.0)

    def test_missing_z_defaults_to_zero(self):
        """2-D point WKT defaults z to 0."""
        assert point_lonlatalt("POINT (10 20)") == (10.0, 20.0, 0.0)

    def test_none_input_raises(self):
        """None input raises ValueError."""
        with pytest.raises(ValueError, match="missing point geometry"):
            point_lonlatalt(None)

    def test_empty_string_raises(self):
        """empty string input raises ValueError."""
        with pytest.raises(ValueError, match="missing point geometry"):
            point_lonlatalt("")

    def test_linestring_input_raises(self):
        """non-Point geometry raises ValueError."""
        with pytest.raises(ValueError, match="expected Point"):
            point_lonlatalt("LINESTRING Z (0 0 0, 1 1 0)")

    def test_polygon_input_raises(self):
        """polygon WKT raises ValueError."""
        with pytest.raises(ValueError, match="expected Point"):
            point_lonlatalt("POLYGON Z ((0 0 0, 1 0 0, 1 1 0, 0 0 0))")


class TestPolygonXY:
    """tests for polygon_xy."""

    def test_returns_exterior_ring(self):
        """polygon WKT yields exterior-ring (lon, lat) pairs."""
        wkt = "POLYGON Z ((0 0 0, 1 0 0, 1 1 0, 0 1 0, 0 0 0))"
        assert polygon_xy(wkt) == [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]

    def test_drops_interior_rings(self):
        """only the exterior ring is returned, holes are skipped."""
        wkt = (
            "POLYGON Z ("
            "(0 0 0, 10 0 0, 10 10 0, 0 10 0, 0 0 0),"
            "(2 2 0, 8 2 0, 8 8 0, 2 8 0, 2 2 0)"
            ")"
        )
        assert polygon_xy(wkt) == [
            (0.0, 0.0),
            (10.0, 0.0),
            (10.0, 10.0),
            (0.0, 10.0),
            (0.0, 0.0),
        ]

    def test_none_returns_empty(self):
        """None input yields []."""
        assert polygon_xy(None) == []

    def test_empty_string_returns_empty(self):
        """empty string yields []."""
        assert polygon_xy("") == []

    def test_non_polygon_raises(self):
        """non-Polygon geometry raises ValueError."""
        with pytest.raises(ValueError, match="expected Polygon"):
            polygon_xy("POINT Z (10 20 30)")

    def test_multipoint_raises(self):
        """unsupported MultiPoint geometry raises ValueError."""
        with pytest.raises(ValueError):
            polygon_xy("MULTIPOINT Z ((0 0 0), (1 1 0))")


class TestLineStringXY:
    """tests for linestring_xy."""

    def test_returns_2d_pairs(self):
        """linestring WKT yields (lon, lat) pairs (z dropped)."""
        wkt = "LINESTRING Z (0 0 0, 1 1 5, 2 2 10)"
        assert linestring_xy(wkt) == [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]

    def test_none_returns_empty(self):
        """None input yields []."""
        assert linestring_xy(None) == []

    def test_empty_string_returns_empty(self):
        """empty string yields []."""
        assert linestring_xy("") == []

    def test_non_linestring_raises(self):
        """non-LineString geometry raises ValueError."""
        with pytest.raises(ValueError, match="expected LineString"):
            linestring_xy("POLYGON Z ((0 0 0, 1 0 0, 1 1 0, 0 0 0))")

    def test_multipoint_raises(self):
        """unsupported MultiPoint geometry raises ValueError."""
        with pytest.raises(ValueError):
            linestring_xy("MULTIPOINT Z ((0 0 0), (1 1 0))")


# the two classes below pin observed behavior for inputs that should never
# reach these helpers (geometry columns are written as well-formed WKT).
# pinning makes the failure mode explicit - a raise or a documented empty
# value, never silently wrong coordinates. behavior changes here belong in
# a follow-up issue, not a test edit.


class TestMalformedWkt:
    """malformed WKT surfaces as a shapely parse error from every helper."""

    MALFORMED = [
        "not a geometry",
        "POINT Z (10 20",
        "POINT Z (abc def ghi)",
        "LINESTRING Z (0 0 0, 1 1",
        "POLYGON Z ((0 0 0, 1 1 1",
    ]

    @pytest.mark.parametrize(
        "helper", [wkt_to_shapely, wkt_to_geojson, point_lonlatalt, polygon_xy, linestring_xy]
    )
    @pytest.mark.parametrize("wkt", MALFORMED)
    def test_garbage_and_truncated_wkt_raise(self, helper, wkt):
        """garbage strings and truncated coordinates raise ShapelyError, never return data."""
        with pytest.raises(ShapelyError):
            helper(wkt)

    def test_parse_error_is_not_value_error(self):
        """the GEOS parse error is not a ValueError - callers cannot catch it as one."""
        with pytest.raises(ShapelyError) as exc_info:
            point_lonlatalt("POINT Z (10 20")
        assert not isinstance(exc_info.value, ValueError)

    def test_unclosed_polygon_ring_raises(self):
        """structurally valid WKT with an invalid ring still raises ShapelyError."""
        with pytest.raises(ShapelyError):
            polygon_xy("POLYGON ((0 0, 1 1))")


class TestEmptyGeometryWkt:
    """EMPTY WKT geometries - per-helper raise-or-empty behavior."""

    def test_wkt_to_shapely_parses_empty_point(self):
        """the parser itself accepts EMPTY - strictness lives in the downstream helpers."""
        assert wkt_to_shapely("POINT EMPTY").is_empty

    @pytest.mark.parametrize("wkt", ["POINT EMPTY", "POINT Z EMPTY"])
    def test_point_empty_raises_in_point_lonlatalt(self, wkt):
        """POINT EMPTY has no coordinates - extracting them raises IndexError."""
        with pytest.raises(IndexError):
            point_lonlatalt(wkt)

    def test_point_empty_raises_in_wkt_to_geojson(self):
        """wkt_to_geojson on POINT EMPTY raises IndexError on the coordinate access."""
        with pytest.raises(IndexError):
            wkt_to_geojson("POINT EMPTY")

    @pytest.mark.parametrize("wkt", ["POLYGON EMPTY", "POLYGON Z EMPTY"])
    def test_polygon_empty_returns_empty_list(self, wkt):
        """POLYGON EMPTY yields [] - same shape as empty/None input."""
        assert polygon_xy(wkt) == []

    @pytest.mark.parametrize("wkt", ["LINESTRING EMPTY", "LINESTRING Z EMPTY"])
    def test_linestring_empty_returns_empty_list(self, wkt):
        """LINESTRING EMPTY yields [] - same shape as empty/None input."""
        assert linestring_xy(wkt) == []

    def test_geometrycollection_empty_raises_value_error(self):
        """GEOMETRYCOLLECTION EMPTY parses but is an unsupported geometry type."""
        with pytest.raises(ValueError, match="unsupported geometry type"):
            wkt_to_geojson("GEOMETRYCOLLECTION EMPTY")
