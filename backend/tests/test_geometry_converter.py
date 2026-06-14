"""tests for geojson<->wkt conversion and schema/dict update application with geometry handling."""

from types import SimpleNamespace
from typing import Optional

import pytest
from pydantic import BaseModel

from app.core.geometry import wkt_to_geojson
from app.schemas.geometry import LineStringZ, PointZ, PolygonZ
from app.services.geometry_converter import (
    apply_dict_update,
    apply_schema_update,
    geojson_to_wkt,
    schema_to_model_data,
)

# helper schemas for testing


class FakeSchema(BaseModel):
    """pydantic schema with a geometry field and a plain field."""

    name: str
    location: Optional[dict] = None


class FakeUpdateSchema(BaseModel):
    """pydantic schema used for partial updates."""

    name: Optional[str] = None
    location: Optional[dict] = None


class _FakeColumn:
    """stand-in for a sqlalchemy Column object exposing only `.nullable`."""

    def __init__(self, nullable: bool):
        """remember nullability flag."""
        self.nullable = nullable


class _FakeTable:
    """stand-in for `obj.__table__` exposing a `.columns` dict."""

    def __init__(self, columns: dict[str, bool]):
        """build column map from {name: nullable} dict."""
        self.columns = {k: _FakeColumn(v) for k, v in columns.items()}


def _model(columns: dict[str, bool], **attrs) -> SimpleNamespace:
    """build a fake ORM-like object with __table__ and initial attrs."""
    obj = SimpleNamespace(**attrs)
    obj.__table__ = _FakeTable(columns)
    return obj


class TestGeojsonToWkt:
    """tests for geojson_to_wkt conversion."""

    def test_point(self):
        """point geojson converts to POINT Z WKT."""
        geojson = {"type": "Point", "coordinates": [16.5, 48.1, 300.0]}
        result = geojson_to_wkt(geojson)
        assert result == "POINT Z (16.5 48.1 300.0)"

    def test_linestring(self):
        """linestring geojson converts to LINESTRING Z WKT."""
        geojson = {
            "type": "LineString",
            "coordinates": [[16.5, 48.1, 300.0], [16.6, 48.2, 310.0]],
        }
        result = geojson_to_wkt(geojson)
        assert result == "LINESTRING Z (16.5 48.1 300.0, 16.6 48.2 310.0)"

    def test_polygon(self):
        """polygon geojson converts to POLYGON Z WKT."""
        geojson = {
            "type": "Polygon",
            "coordinates": [
                [[16.5, 48.1, 0], [16.6, 48.1, 0], [16.6, 48.2, 0], [16.5, 48.1, 0]],
            ],
        }
        result = geojson_to_wkt(geojson)
        assert result == ("POLYGON Z ((16.5 48.1 0, 16.6 48.1 0, 16.6 48.2 0, 16.5 48.1 0))")

    def test_polygon_with_hole(self):
        """polygon with interior ring converts both rings."""
        outer = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 0, 0]]
        inner = [[2, 2, 0], [8, 2, 0], [8, 8, 0], [2, 2, 0]]
        geojson = {"type": "Polygon", "coordinates": [outer, inner]}
        result = geojson_to_wkt(geojson)
        assert "POLYGON Z (" in result
        assert result.count("(") == 3  # outer parens + two rings

    def test_unsupported_type_raises(self):
        """unsupported geometry type raises ValueError."""
        geojson = {"type": "MultiPoint", "coordinates": [[0, 0, 0]]}
        with pytest.raises(ValueError, match="unsupported geometry type"):
            geojson_to_wkt(geojson)


class TestSchemaToModelData:
    """tests for schema_to_model_data conversion."""

    def test_converts_geometry_fields(self):
        """geometry field is converted to WKT string, plain fields pass through."""
        schema = FakeSchema(
            name="test",
            location={"type": "Point", "coordinates": [16.5, 48.1, 300.0]},
        )
        data = schema_to_model_data(schema)
        assert data["name"] == "test"
        assert isinstance(data["location"], str)
        assert data["location"] == "POINT Z (16.5 48.1 300.0)"

    def test_none_geometry_left_as_none(self):
        """None geometry fields are not converted."""
        schema = FakeSchema(name="test", location=None)
        data = schema_to_model_data(schema)
        assert data["location"] is None
        assert data["name"] == "test"


class TestApplyDictUpdate:
    """tests for apply_dict_update."""

    def test_sets_attributes_with_geometry_conversion(self):
        """geometry fields are converted to WKT string when set on object."""
        obj = _model({"location": False})
        data = {
            "name": "mission-1",
            "location": {"type": "Point", "coordinates": [16.5, 48.1, 300.0]},
        }
        apply_dict_update(obj, data)
        assert obj.name == "mission-1"
        assert isinstance(obj.location, str)
        assert obj.location == "POINT Z (16.5 48.1 300.0)"

    def test_none_non_nullable_geometry_skipped(self):
        """none on non-nullable geometry fields is skipped to protect constraints."""
        obj = _model({"location": False}, location="existing")
        apply_dict_update(obj, {"location": None})
        assert obj.location == "existing"

    def test_none_nullable_geometry_set(self):
        """none on nullable geometry fields is applied (e.g. camera_target)."""
        obj = _model({"camera_target": True}, camera_target="existing")
        apply_dict_update(obj, {"camera_target": None})
        assert obj.camera_target is None

    def test_none_boundary_cleared_when_nullable(self):
        """nullable boundary (AirfieldSurface) accepts explicit None to clear it."""
        obj = _model({"boundary": True}, boundary="existing")
        apply_dict_update(obj, {"boundary": None})
        assert obj.boundary is None

    def test_none_boundary_skipped_when_non_nullable(self):
        """non-nullable boundary (Obstacle) silently drops explicit None."""
        obj = _model({"boundary": False}, boundary="existing")
        apply_dict_update(obj, {"boundary": None})
        assert obj.boundary == "existing"

    def test_non_geometry_field_set_directly(self):
        """non-geometry fields are set without conversion."""
        obj = _model({})
        apply_dict_update(obj, {"status": "DRAFT", "priority": 5})
        assert obj.status == "DRAFT"
        assert obj.priority == 5


class TestApplySchemaUpdate:
    """tests for apply_schema_update."""

    def test_delegates_to_apply_dict_update(self):
        """schema update converts and applies geometry fields to object."""
        obj = _model({"location": False}, name="old", location="old-wkt")
        schema = FakeUpdateSchema(
            name="new",
            location={"type": "Point", "coordinates": [1.0, 2.0, 3.0]},
        )
        apply_schema_update(obj, schema)
        assert obj.name == "new"
        assert isinstance(obj.location, str)
        assert obj.location == "POINT Z (1.0 2.0 3.0)"

    def test_excludes_unset_fields(self):
        """only explicitly set fields are applied."""
        obj = _model({"location": False}, name="original", location="keep-this")
        schema = FakeUpdateSchema(name="updated")
        apply_schema_update(obj, schema)
        assert obj.name == "updated"
        assert obj.location == "keep-this"


class TestWktRoundTrip:
    """tests that wkt_to_geojson handles malformed input gracefully."""

    def test_empty_string_returns_none(self):
        """empty string yields None."""
        assert wkt_to_geojson("") is None

    def test_none_returns_none(self):
        """None input yields None."""
        assert wkt_to_geojson(None) is None

    def test_garbage_raises(self):
        """garbage WKT raises a parse error from shapely."""
        with pytest.raises(Exception):  # shapely GEOSException
            wkt_to_geojson("not-wkt")


class TestGeojsonToWkt2D:
    """tests that geojson_to_wkt handles 2D coordinates gracefully."""

    def test_2d_point_defaults_z_to_zero(self):
        """2D point coordinates default z to 0."""
        geojson = {"type": "Point", "coordinates": [16.5, 48.1]}
        result = geojson_to_wkt(geojson)
        assert result == "POINT Z (16.5 48.1 0)"

    def test_2d_linestring_defaults_z_to_zero(self):
        """2D linestring coordinates default z to 0."""
        geojson = {"type": "LineString", "coordinates": [[16.5, 48.1], [16.6, 48.2]]}
        result = geojson_to_wkt(geojson)
        assert result == "LINESTRING Z (16.5 48.1 0, 16.6 48.2 0)"

    def test_1d_coordinate_raises_valueerror(self):
        """coordinate with only 1 element raises ValueError."""
        geojson = {"type": "Point", "coordinates": [16.5]}
        with pytest.raises(ValueError, match="at least 2 elements"):
            geojson_to_wkt(geojson)


class TestPolygonZRingClosure:
    """tests that PolygonZ validates ring closure."""

    def test_unclosed_ring_rejected(self):
        """unclosed polygon ring is rejected."""
        with pytest.raises(Exception, match="not closed"):
            PolygonZ(
                type="Polygon",
                coordinates=[[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]],
            )

    def test_closed_ring_accepted(self):
        """closed polygon ring is accepted."""
        pg = PolygonZ(
            type="Polygon",
            coordinates=[[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]],
        )
        assert len(pg.coordinates[0]) == 4


class TestGeometrySchemaValidation:
    """tests that geometry schemas reject 2D coordinates."""

    def test_pointz_rejects_2d(self):
        """PointZ rejects coordinates without altitude."""
        with pytest.raises(Exception, match="at least 3 elements"):
            PointZ(type="Point", coordinates=[16.5, 48.1])

    def test_pointz_accepts_3d(self):
        """PointZ accepts coordinates with altitude."""
        p = PointZ(type="Point", coordinates=[16.5, 48.1, 300.0])
        assert len(p.coordinates) == 3

    def test_pointz_parses_wkt_string(self):
        """PointZ accepts a WKT string and round-trips coordinates."""
        p = PointZ.model_validate("POINT Z (16.5 48.1 300.0)")
        assert p.coordinates == [16.5, 48.1, 300.0]

    def test_linestringz_rejects_2d(self):
        """LineStringZ rejects coordinates without altitude."""
        with pytest.raises(Exception, match="at least 3 elements"):
            LineStringZ(type="LineString", coordinates=[[16.5, 48.1], [16.6, 48.2]])

    def test_linestringz_accepts_3d(self):
        """LineStringZ accepts coordinates with altitude."""
        ls = LineStringZ(type="LineString", coordinates=[[16.5, 48.1, 0], [16.6, 48.2, 0]])
        assert len(ls.coordinates) == 2

    def test_linestringz_parses_wkt_string(self):
        """LineStringZ accepts a WKT string."""
        ls = LineStringZ.model_validate("LINESTRING Z (16.5 48.1 0, 16.6 48.2 0)")
        assert len(ls.coordinates) == 2

    def test_polygonz_rejects_2d(self):
        """PolygonZ rejects coordinates without altitude."""
        with pytest.raises(Exception, match="at least 3 elements"):
            PolygonZ(
                type="Polygon",
                coordinates=[[[0, 0], [1, 0], [1, 1], [0, 0]]],
            )

    def test_polygonz_accepts_3d(self):
        """PolygonZ accepts coordinates with altitude."""
        pg = PolygonZ(
            type="Polygon",
            coordinates=[[[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]]],
        )
        assert len(pg.coordinates[0]) == 4

    def test_polygonz_parses_wkt_string(self):
        """PolygonZ accepts a WKT string."""
        pg = PolygonZ.model_validate("POLYGON Z ((0 0 0, 1 0 0, 1 1 0, 0 0 0))")
        assert len(pg.coordinates[0]) == 4
