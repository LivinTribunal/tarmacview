"""GeoJSON-to-WKT conversion and schema-to-ORM geometry mapping."""

from typing import Any

from pydantic import BaseModel

GeoJSON = dict[str, Any]
WKT = str

# all geometry column names across the project
GEOM_FIELDS = {
    "location",
    "geometry",
    "position",
    "threshold_position",
    "end_position",
    "takeoff_coordinate",
    "landing_coordinate",
    "camera_target",
    "boundary",
}

# transport-only schema fields that must never be written to the model
TRANSPORT_ONLY_FIELDS = {"preserve_altitude"}


def _fmt_coord(c: list) -> str:
    """format a single coordinate as 'x y z', defaulting z to 0 if missing."""
    if len(c) < 2:
        raise ValueError(f"coordinate must have at least 2 elements, got {len(c)}")
    z = c[2] if len(c) >= 3 else 0
    return f"{c[0]} {c[1]} {z}"


def geojson_to_wkt(geojson: GeoJSON) -> WKT:
    """convert GeoJSON dict to ISO WKT string with explicit Z dimension."""
    coords = geojson["coordinates"]
    geom_type = geojson["type"]

    if geom_type == "Point":
        return f"POINT Z ({_fmt_coord(coords)})"

    if geom_type == "LineString":
        pts = ", ".join(_fmt_coord(c) for c in coords)

        return f"LINESTRING Z ({pts})"

    if geom_type == "Polygon":
        rings = []
        for ring in coords:
            pts = ", ".join(_fmt_coord(c) for c in ring)
            rings.append(f"({pts})")

        return f"POLYGON Z ({', '.join(rings)})"

    raise ValueError(f"unsupported geometry type: {geom_type}")


def schema_to_model_data(schema: BaseModel) -> dict:
    """convert pydantic schema to dict with geometry fields as WKT strings."""
    data = schema.model_dump()
    for f in TRANSPORT_ONLY_FIELDS:
        data.pop(f, None)
    for key in GEOM_FIELDS & data.keys():
        if data[key] is not None:
            data[key] = geojson_to_wkt(data[key])

    return data


def apply_schema_update(obj, schema: BaseModel, *, skip: set[str] | None = None):
    """apply pydantic update schema to ORM model, converting geometry to WKT strings.

    `skip` adds caller-owned fields to the transport-only filter - useful when
    the caller writes those fields through a separate path (e.g. sequence
    shifts) and must keep them out of the generic setattr loop.
    """
    data = schema.model_dump(exclude_unset=True)
    for f in TRANSPORT_ONLY_FIELDS:
        data.pop(f, None)
    if skip:
        for f in skip:
            data.pop(f, None)
    apply_dict_update(obj, data)


def apply_dict_update(obj, data: dict):
    """apply dict to ORM model, converting geometry fields to WKT strings.

    explicit None on a non-nullable geometry column is dropped (treated as
    'no change') so PATCH-style updates do not have to know which fields
    are required at the db level.
    """
    table = obj.__table__
    for key, val in data.items():
        if key in GEOM_FIELDS:
            if val is not None:
                setattr(obj, key, geojson_to_wkt(val))
            elif _is_column_nullable(table, key):
                setattr(obj, key, None)
        else:
            setattr(obj, key, val)


def _is_column_nullable(table, key: str) -> bool:
    """check if an ORM table column is nullable, defaults to True if unknown."""
    column = table.columns.get(key)
    if column is None:
        return True
    return bool(column.nullable)
