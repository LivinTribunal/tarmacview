"""structural guard: the airport service package exposes the exact pre-split surface.

frozen behavior contract for the decomposition of the former single-file
``app/services/airport_service.py`` into the ``app.services.airport`` package.
asserts every pre-refactor public name resolves from both the package and the
``airport_service`` shim, that the two resolve to the *same* object (so route
imports and test monkeypatches stay byte-identical), and that the route-facing
call surface is intact. a dropped / renamed re-export breaks this on purpose.
"""

from app.services import airport as airport_pkg
from app.services import airport_service

# every name the routers + tests reference through ``airport_service.<name>``.
# byte-identical to the pre-split public surface. underscore helpers are listed
# only when a test imports them directly (parity is enforced for those too).
EXPECTED_PUBLIC = {
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
}


def test_package_all_is_byte_identical():
    """the package __all__ is exactly the frozen pre-split public surface."""
    assert set(airport_pkg.__all__) == EXPECTED_PUBLIC


def test_shim_all_mirrors_package_all():
    """the airport_service shim re-exports the package __all__ unchanged."""
    assert airport_service.__all__ == airport_pkg.__all__


def test_every_public_name_resolves_from_both_package_and_shim():
    """no symbol was dropped: each name is importable from the package and shim."""
    for name in EXPECTED_PUBLIC:
        assert hasattr(airport_pkg, name), f"missing from package: {name}"
        assert hasattr(airport_service, name), f"missing from shim: {name}"


def test_shim_and_package_resolve_to_the_same_object():
    """the shim re-exports the package's objects, not copies.

    route imports (``airport_service.create_obstacle``) and the
    ``airports_route.airport_service`` monkeypatch sites only stay correct if
    the shim attribute *is* the package attribute.
    """
    for name in EXPECTED_PUBLIC:
        assert getattr(airport_service, name) is getattr(airport_pkg, name), (
            f"shim/package object identity drift for {name}"
        )


def test_route_facing_callables_are_callable():
    """every route-dispatched name (constants excluded) is callable through the shim."""
    constants = {
        "ELEVATION_FIELDS",
        "GEOTIFF_NODATA",
        "MAX_BATCH_TIMEOUT_SECONDS",
        "MAX_EDGE_LIGHT_UNITS",
        "PAPI_MAX_LIGHTS",
    }
    for name in EXPECTED_PUBLIC - constants:
        assert callable(getattr(airport_service, name)), f"not callable: {name}"
