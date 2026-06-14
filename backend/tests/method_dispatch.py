"""test helper - run the method dispatcher from the legacy keyword interface.

post-#862 `compute_measurement_trajectory` takes `(ctx, prep)`. the direct-dispatch
unit tests exercise handler routing / terrain / video behavior, not the call
shape, so this helper builds the `MethodContext` + `MethodPrep` from the old
keyword arguments and keeps those test bodies readable. the new `(ctx, prep)`
signature itself is pinned by `test_trajectory_methods_split.py` and the
orchestrator end-to-end suites.
"""

from app.services.trajectory.methods import compute_measurement_trajectory
from app.services.trajectory.types import MethodContext, MethodPrep


class _FovDrone:
    """drone stub carrying only sensor_fov for the surface-scan handler."""

    def __init__(self, sensor_fov):
        """store the sensor field of view."""
        self.sensor_fov = sensor_fov


def make_context(
    inspection,
    config,
    *,
    center=None,
    runway_heading=0.0,
    glide_slope=3.0,
    speed=5.0,
    default_speed=None,
    setting_angles=None,
    template=None,
    surfaces=None,
    drone=None,
    elevation_provider=None,
    ordered_lhas=None,
):
    """build a MethodContext for prepare-step unit tests, defaulting the rest."""
    return MethodContext(
        inspection=inspection,
        config=config,
        center=center,
        runway_heading=runway_heading,
        glide_slope=glide_slope,
        speed=speed,
        default_speed=default_speed if default_speed is not None else speed,
        setting_angles=setting_angles or [],
        template=template,
        surfaces=surfaces or [],
        drone=drone,
        elevation_provider=elevation_provider,
        ordered_lhas=ordered_lhas or [],
    )


def dispatch_trajectory(
    inspection,
    config,
    center,
    runway_heading,
    glide_slope,
    speed,
    setting_angles,
    *,
    elevation_provider=None,
    ordered_lha_positions=None,
    target_lha_position=None,
    target_agl_type=None,
    runway_center=None,
    touchpoint=None,
    scan_surface=None,
    sensor_fov=None,
    drone=None,
):
    """build (ctx, prep) from legacy kwargs and run compute_measurement_trajectory."""
    if drone is None and sensor_fov is not None:
        drone = _FovDrone(sensor_fov)
    ctx = MethodContext(
        inspection=inspection,
        config=config,
        center=center,
        runway_heading=runway_heading,
        glide_slope=glide_slope,
        speed=speed,
        default_speed=speed,
        setting_angles=setting_angles,
        template=None,
        surfaces=[],
        drone=drone,
        elevation_provider=elevation_provider,
        ordered_lhas=ordered_lha_positions or [],
    )
    prep = MethodPrep(
        target_lha_pos=target_lha_position,
        target_agl_type=target_agl_type,
        runway_center=runway_center,
        touchpoint=touchpoint,
        scan_surface=scan_surface,
    )
    return compute_measurement_trajectory(ctx, prep)
