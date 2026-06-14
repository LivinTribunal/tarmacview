"""dji waylines.wpml standalone export."""

from app.models.flight_plan import FlightPlan

from ..dji import _build_dji_waylines_wpml


def generate_wpml(
    flight_plan: FlightPlan,
    mission_name: str = "",
    airport_elevation: float = 0,
    *,
    mission=None,
    drone_profile=None,
    scope: str = "FULL",
    heading_mode_override: str | None = None,
    clamps: list[dict] | None = None,
) -> bytes:
    """serialize flight plan to dji waylines.wpml - the executable wayline file.

    when `clamps` is supplied, any below-takeoff placemark altitude is
    appended so the orchestrator can refuse the file until the operator
    acknowledges the modification.
    """
    return _build_dji_waylines_wpml(
        flight_plan,
        mission_name,
        airport_elevation,
        mission,
        drone_profile,
        scope=scope,
        heading_mode_override=heading_mode_override,
        clamps=clamps,
    )
