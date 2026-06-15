"""structural guard for the R4 backend non-critical decomposition.

frozen behavior contract for issue #610: four independent behavior-neutral
splits, each preserving its public import path via a re-export shim / barrel.
asserts the prior public names resolve from both the new home and the shim and
that the two resolve to the *same* object (so production imports and test
monkeypatch sites stay byte-identical). a dropped / renamed re-export, an
import cycle, or a reordered mission route breaks this on purpose.
"""


# openaip_service.py -> openaip/ package + shim
def test_openaip_shim_mirrors_package():
    """every helper the routers + tests reach resolves identically via the shim."""
    from app.services import openaip_service
    from app.services.openaip import client, conversions, geometry, parsers

    # the shim may re-export private helpers too (defensive against legacy
    # monkeypatch sites); only the public entrypoint's presence is required.
    assert "lookup_airport_by_icao" in openaip_service.__all__

    from app.services.openaip import __all__ as pkg_all

    assert "lookup_airport_by_icao" in pkg_all

    # public entrypoint resolves to the one object across shim / package / submodule
    from app.services.openaip import lookup_airport_by_icao as pkg_lookup

    assert openaip_service.lookup_airport_by_icao is pkg_lookup
    assert openaip_service.lookup_airport_by_icao is client.lookup_airport_by_icao

    # the private surface the test suite + airports route reach, each pinned to
    # the submodule that owns it (so patch("...openaip.client._get") lands)
    owners = {
        client: ["_client", "_get", "_pick_matching_airport", "lookup_airport_by_icao"],
        conversions: ["_convert_altitude_limit", "_convert_length"],
        geometry: ["_compute_runway_geometry", "_generate_obstacle_boundary"],
        parsers: [
            "_map_airspace_type",
            "_map_obstacle_type",
            "_parse_airspace",
            "_parse_obstacle",
            "_parse_polygon_geometry",
            "_parse_runway",
        ],
    }
    for module, names in owners.items():
        for name in names:
            assert getattr(openaip_service, name) is getattr(module, name), (
                f"openaip shim/object identity drift for {name}"
            )


# export/dji/builders.py -> builders.py + mission_config.py + placemark.py
def test_dji_builders_split_resolves_without_cycle():
    """document builders re-import the moved clusters; the dji barrel is unchanged."""
    from app.services.export import shared
    from app.services.export.dji import (
        actions,
        builders,
        heading,
        mission_config,
        placemark,
        video,
    )

    assert builders._build_dji_template_kml is not None
    assert builders._build_dji_waylines_wpml is not None

    # mission-config + small route-level emitters stay in mission_config
    for name in (
        "_append_mission_config",
        "_emitted_distance_duration",
        "_max_relative_height",
        "_resolve_auto_speed",
    ):
        assert getattr(builders, name) is getattr(mission_config, name), (
            f"dji builders/mission_config object identity drift for {name}"
        )

    # per-waypoint placemark emission lives in placemark and builders re-imports it
    for name in (
        "_append_placemark",
        "_append_payload_param",
        "_nearest_leg_lengths",
        "_zoom_factor_for",
    ):
        assert getattr(builders, name) is getattr(placemark, name), (
            f"dji builders/placemark object identity drift for {name}"
        )

    # _append_turn_param is consumed by _append_placemark only; pin its owner
    assert placemark._append_turn_param is not None
    assert not hasattr(mission_config, "_append_turn_param")
    assert not hasattr(builders, "_append_turn_param")

    # the enum helper stays with its sole caller (_append_mission_config)
    assert mission_config._dji_enums_for is not None
    assert not hasattr(builders, "_dji_enums_for")

    # the placemark cluster no longer hangs off mission_config
    for moved in (
        "_append_placemark",
        "_append_payload_param",
        "_nearest_leg_lengths",
        "_zoom_factor_for",
    ):
        assert not hasattr(mission_config, moved), (
            f"{moved} should have moved out of mission_config"
        )

    # shared xml primitives still single-source through builders (pinned elsewhere too)
    assert builders._sub_text is shared._sub_text
    assert builders._kml_tag is shared._kml_tag
    assert builders._KML_KEEPOUT_DESCRIPTION is shared._KML_KEEPOUT_DESCRIPTION

    # the externally-consumed dji barrel surface is unchanged
    from app.services.export import dji

    assert dji._build_dji_template_kml is builders._build_dji_template_kml
    assert dji._build_dji_waylines_wpml is builders._build_dji_waylines_wpml
    assert placemark._append_action_group is actions._append_action_group
    assert placemark._append_segment_action_group is actions._append_segment_action_group
    assert placemark._append_heading_param is heading._append_heading_param
    assert placemark._emits_followwayline_block is heading._emits_followwayline_block
    assert callable(video._video_smooth_emit_plan)


# admin_service.py -> admin_service.py + admin_settings.py
def test_admin_settings_split_shim_mirrors_module():
    """settings names re-export from admin_service; user lifecycle stays put."""
    from app.services import admin_service, admin_settings

    for name in (
        "SETTINGS_DEFAULTS",
        "get_system_settings",
        "update_system_settings",
        "is_maintenance_mode",
    ):
        assert getattr(admin_service, name) is getattr(admin_settings, name), (
            f"admin settings re-export object identity drift for {name}"
        )

    # the user-lifecycle + airports-overview surface stays on admin_service
    for name in (
        "_assert_not_self",
        "_assert_not_last_super_admin",
        "list_users",
        "get_user",
        "invite_user",
        "update_user",
        "deactivate_user",
        "activate_user",
        "delete_user",
        "reset_password",
        "update_airport_assignments",
        "list_airports_admin",
    ):
        assert callable(getattr(admin_service, name)), f"missing from admin_service: {name}"

    # main.py imports is_maintenance_mode straight off the shim path
    from app.services.admin_service import is_maintenance_mode

    assert is_maintenance_mode is admin_settings.is_maintenance_mode


# api/routes/missions.py -> missions/ package + barrel
def test_missions_router_surface_and_order_preserved():
    """the package router exposes the exact pre-split route set + ordering."""
    from app.api.routes.missions import router
    from app.api.routes.missions.core import router as core_router
    from app.api.routes.missions.inspections import router as inspections_router
    from app.api.routes.missions.measurements import router as measurements_router

    assert core_router is not None
    assert inspections_router is not None
    assert measurements_router is not None

    registered = [
        (sorted(m for m in r.methods if m != "HEAD")[0], r.path, r.endpoint.__name__)
        for r in router.routes
    ]
    expected = [
        ("GET", "/api/v1/missions", "list_missions"),
        ("POST", "/api/v1/missions", "create_mission"),
        ("GET", "/api/v1/missions/{mission_id}", "get_mission"),
        ("GET", "/api/v1/missions/{mission_id}/drone-media", "list_mission_drone_media"),
        ("PUT", "/api/v1/missions/{mission_id}", "update_mission"),
        ("DELETE", "/api/v1/missions/{mission_id}", "delete_mission"),
        ("POST", "/api/v1/missions/{mission_id}/duplicate", "duplicate_mission"),
        ("POST", "/api/v1/missions/{mission_id}/validate", "validate_mission"),
        ("POST", "/api/v1/missions/{mission_id}/export", "export_mission"),
        ("POST", "/api/v1/missions/{mission_id}/dispatch", "dispatch_mission"),
        ("GET", "/api/v1/missions/{mission_id}/mission-report", "get_mission_report"),
        ("POST", "/api/v1/missions/{mission_id}/complete", "complete_mission"),
        ("POST", "/api/v1/missions/{mission_id}/cancel", "cancel_mission"),
        ("POST", "/api/v1/missions/{mission_id}/inspections", "add_inspection"),
        ("PUT", "/api/v1/missions/{mission_id}/inspections/reorder", "reorder_inspections"),
        (
            "PUT",
            "/api/v1/missions/{mission_id}/inspections/{inspection_id}",
            "update_inspection",
        ),
        (
            "DELETE",
            "/api/v1/missions/{mission_id}/inspections/{inspection_id}",
            "delete_inspection",
        ),
        (
            "GET",
            "/api/v1/missions/{mission_id}/measurements",
            "list_mission_measurements",
        ),
    ]
    assert registered == expected

    # the static reorder route must resolve before its {inspection_id} sibling
    paths = [p for _, p, _ in registered]
    assert paths.index("/api/v1/missions/{mission_id}/inspections/reorder") < paths.index(
        "/api/v1/missions/{mission_id}/inspections/{inspection_id}"
    )
