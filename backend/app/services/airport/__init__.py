"""airport / surface / obstacle / safety-zone CRUD, altitude renormalize, lha reorder, pairs.

the 2171-line ``airport_service`` module was split into this package by
aggregate: ``core`` (airport + drone), ``surfaces`` (surface + pair-link),
``obstacles``, ``safety_zone``, ``agl``, ``lha`` (reorder + PAPI invariant),
``terrain`` (DEM upload/delete + download), and ``altitude`` (the shared
per-airport renormalize protocol + every elevation-provider construction).
this ``__init__`` re-exports the prior module's public surface so callers keep
``from app.services import airport_service`` (a thin shim re-exporting this
package) byte-identical.
"""

from app.services.airport.agl import (
    create_agl,
    delete_agl,
    list_agls,
    update_agl,
)
from app.services.airport.altitude import (
    _normalize_position_altitude,
    get_elevation_at_point,
    renormalize_airport_altitudes,
)
from app.services.airport.core import (
    ELEVATION_FIELDS,
    bulk_change_drone,
    create_airport,
    delete_airport,
    elevation_fields_changed,
    get_airport,
    list_airports,
    list_airports_with_counts,
    set_default_drone,
    update_airport,
)
from app.services.airport.lha import (
    MAX_EDGE_LIGHT_UNITS,
    PAPI_MAX_LIGHTS,
    bulk_generate_lhas,
    create_lha,
    delete_lha,
    list_lhas,
    update_lha,
)
from app.services.airport.obstacles import (
    create_obstacle,
    delete_obstacle,
    list_obstacles,
    recalculate_obstacle_dimensions,
    update_obstacle,
)
from app.services.airport.safety_zone import (
    create_safety_zone,
    delete_safety_zone,
    list_safety_zones,
    update_safety_zone,
)
from app.services.airport.surfaces import (
    couple_surfaces,
    create_reverse_surface,
    create_surface,
    decouple_surfaces,
    delete_surface,
    list_surfaces,
    recalculate_surface_dimensions,
    update_surface,
)
from app.services.airport.terrain import (
    GEOTIFF_NODATA,
    MAX_BATCH_TIMEOUT_SECONDS,
    delete_terrain_dem,
    download_terrain_for_location,
    get_airport_lonlat,
    get_dem_file_path,
    upload_terrain_dem,
)

__all__ = [
    "ELEVATION_FIELDS",
    "GEOTIFF_NODATA",
    "MAX_BATCH_TIMEOUT_SECONDS",
    "MAX_EDGE_LIGHT_UNITS",
    "PAPI_MAX_LIGHTS",
    "_normalize_position_altitude",
    "bulk_change_drone",
    "bulk_generate_lhas",
    "couple_surfaces",
    "create_agl",
    "create_airport",
    "create_lha",
    "create_obstacle",
    "create_reverse_surface",
    "create_safety_zone",
    "create_surface",
    "decouple_surfaces",
    "delete_agl",
    "delete_airport",
    "delete_lha",
    "delete_obstacle",
    "delete_safety_zone",
    "delete_surface",
    "delete_terrain_dem",
    "download_terrain_for_location",
    "elevation_fields_changed",
    "get_airport",
    "get_airport_lonlat",
    "get_dem_file_path",
    "get_elevation_at_point",
    "list_agls",
    "list_airports",
    "list_airports_with_counts",
    "list_lhas",
    "list_obstacles",
    "list_safety_zones",
    "list_surfaces",
    "recalculate_obstacle_dimensions",
    "recalculate_surface_dimensions",
    "renormalize_airport_altitudes",
    "set_default_drone",
    "update_agl",
    "update_airport",
    "update_lha",
    "update_obstacle",
    "update_safety_zone",
    "update_surface",
    "upload_terrain_dem",
]
