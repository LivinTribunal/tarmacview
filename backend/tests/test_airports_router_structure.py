"""structural guard: the airports/ router package exposes the exact pre-split route table.

frozen behavior contract for the decomposition of the former single-file
airports router into a per-resource package. asserts the full /api/v1/airports
route set, the package router prefix/tags, per-route tagging, and the one
ordering invariant FastAPI cares about (static suffix before its {uuid} sibling).
"""

from app.api.routes.airports import router as airports_router
from app.main import app

# (method, path, route function name) - 39 routes byte-identical to the
# single-file router before decomposition, plus extract-photo-metadata and the
# airport-scoped measurements list.
# a missing/extra/renamed route or a changed path breaks this on purpose.
EXPECTED_ROUTES = {
    ("GET", "/api/v1/airports", "list_airports"),
    ("POST", "/api/v1/airports", "create_airport"),
    ("GET", "/api/v1/airports/summary", "list_airports_summary"),
    ("GET", "/api/v1/airports/lookup/{icao_code}", "lookup_airport"),
    ("GET", "/api/v1/airports/{airport_id}", "get_airport"),
    ("PUT", "/api/v1/airports/{airport_id}", "update_airport"),
    ("DELETE", "/api/v1/airports/{airport_id}", "delete_airport"),
    ("PUT", "/api/v1/airports/{airport_id}/default-drone", "set_default_drone"),
    ("POST", "/api/v1/airports/{airport_id}/bulk-change-drone", "bulk_change_drone"),
    ("GET", "/api/v1/airports/{airport_id}/elevation", "get_elevation_at_point"),
    ("POST", "/api/v1/airports/{airport_id}/terrain-dem", "upload_terrain_dem"),
    ("DELETE", "/api/v1/airports/{airport_id}/terrain-dem", "delete_terrain_dem"),
    ("POST", "/api/v1/airports/{airport_id}/terrain-download", "download_terrain_data"),
    ("POST", "/api/v1/airports/{airport_id}/extract-photo-metadata", "extract_photo_metadata"),
    ("GET", "/api/v1/airports/{airport_id}/surfaces", "list_surfaces"),
    ("POST", "/api/v1/airports/{airport_id}/surfaces", "create_surface"),
    ("PUT", "/api/v1/airports/{airport_id}/surfaces/{surface_id}", "update_surface"),
    ("DELETE", "/api/v1/airports/{airport_id}/surfaces/{surface_id}", "delete_surface"),
    (
        "POST",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/create-reverse",
        "create_reverse_surface",
    ),
    ("POST", "/api/v1/airports/{airport_id}/surfaces/{surface_id}/couple", "couple_surface"),
    ("POST", "/api/v1/airports/{airport_id}/surfaces/{surface_id}/decouple", "decouple_surface"),
    (
        "POST",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/recalculate",
        "recalculate_surface",
    ),
    ("GET", "/api/v1/airports/{airport_id}/obstacles", "list_obstacles"),
    ("POST", "/api/v1/airports/{airport_id}/obstacles", "create_obstacle"),
    ("PUT", "/api/v1/airports/{airport_id}/obstacles/{obstacle_id}", "update_obstacle"),
    ("DELETE", "/api/v1/airports/{airport_id}/obstacles/{obstacle_id}", "delete_obstacle"),
    (
        "POST",
        "/api/v1/airports/{airport_id}/obstacles/{obstacle_id}/recalculate",
        "recalculate_obstacle",
    ),
    ("GET", "/api/v1/airports/{airport_id}/safety-zones", "list_safety_zones"),
    ("POST", "/api/v1/airports/{airport_id}/safety-zones", "create_safety_zone"),
    ("PUT", "/api/v1/airports/{airport_id}/safety-zones/{zone_id}", "update_safety_zone"),
    ("DELETE", "/api/v1/airports/{airport_id}/safety-zones/{zone_id}", "delete_safety_zone"),
    ("GET", "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls", "list_agls"),
    ("POST", "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls", "create_agl"),
    (
        "PUT",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}",
        "update_agl",
    ),
    (
        "DELETE",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}",
        "delete_agl",
    ),
    (
        "GET",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
        "list_lhas",
    ),
    (
        "POST",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
        "create_lha",
    ),
    (
        "POST",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/bulk",
        "bulk_generate_lhas",
    ),
    (
        "PUT",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/{lha_id}",
        "update_lha",
    ),
    (
        "DELETE",
        "/api/v1/airports/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/{lha_id}",
        "delete_lha",
    ),
    ("GET", "/api/v1/airports/{airport_id}/measurements", "list_airport_measurements"),
}


def _airport_routes():
    """yield (method, path, name) for every registered /api/v1/airports* route."""
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path or not path.startswith("/api/v1/airports"):
            continue
        for method in route.methods:
            if method in ("HEAD", "OPTIONS"):
                continue
            yield method, path, route.name


def test_airports_route_table_is_byte_identical():
    """the package exposes exactly the expected route set - no more, no fewer."""
    actual = set(_airport_routes())
    assert actual == EXPECTED_ROUTES


def test_package_router_prefix_and_tags_unchanged():
    """main.py sees the same router contract: prefix and tags stay byte-identical."""
    assert airports_router.prefix == "/api/v1/airports"
    assert airports_router.tags == ["airports"]


def test_every_airport_route_keeps_the_airports_tag():
    """sub-router decomposition must not drop the openapi 'airports' tag."""
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path or not path.startswith("/api/v1/airports"):
            continue
        assert list(route.tags) == ["airports"], f"{route.name} lost its tag"


def test_static_suffix_routes_match_before_uuid_siblings():
    """GET /summary must be registered ahead of GET /{airport_id} so it isn't parsed as a uuid."""
    order = [
        (m, p)
        for route in app.routes
        if (p := getattr(route, "path", None)) and p.startswith("/api/v1/airports")
        for m in route.methods
        if m not in ("HEAD", "OPTIONS")
    ]
    summary_idx = order.index(("GET", "/api/v1/airports/summary"))
    by_id_idx = order.index(("GET", "/api/v1/airports/{airport_id}"))
    assert summary_idx < by_id_idx
