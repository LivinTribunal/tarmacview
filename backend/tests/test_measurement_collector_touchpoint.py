"""touchpoint-referenced transition angles in the engine collector (additive, regression-safe).

the light-referenced min/max/middle math must stay byte-identical when no TOUCH_POINT is
supplied; the touchpoint keys appear only when a TOUCH_POINT datum is present.
"""

from app.services.video_processing.generation.measurement_collector import MeasurementCollector
from app.services.video_processing.utils import calculate_angle

# a fixed PAPI light and the two touchpoint datums (coincident with the light, and displaced)
LIGHT = {"latitude": 50.10, "longitude": 14.27, "elevation_wgs84": 380.0}
TOUCH_DISPLACED = {"latitude": 50.09, "longitude": 14.20, "elevation_wgs84": 378.0}


def _drone(i: int) -> dict:
    """a moving/descending drone position at frame i."""
    return {
        "latitude": 50.11 - i * 1e-4,
        "longitude": 14.25 + i * 1e-4,
        "elevation_wgs84": 480.0 - i * 2.0,
    }


def _blob() -> list[dict]:
    """40-frame blob: a clean green ramp with papi_a angles derived from calculate_angle."""
    frames = []
    for i in range(40):
        drone = _drone(i)
        green = 50 + i * 5  # clean red->white ramp
        frames.append(
            {
                "frame_number": i,
                "timestamp": i / 30.0,
                "drone_latitude": drone["latitude"],
                "drone_longitude": drone["longitude"],
                "drone_elevation_wgs84": drone["elevation_wgs84"],
                "papi_a_rgb": {"r": 100, "g": green, "b": 100},
                "papi_a_angle": calculate_angle(drone, LIGHT),
            }
        )
    return frames


def test_no_touchpoint_omits_keys_and_keeps_light_referenced_math():
    """no TOUCH_POINT -> touchpoint keys absent; light-referenced output identical to ref=None."""
    frames = _blob()
    without_ref = MeasurementCollector.compute_transition_angles_from_chromacity(
        _blob(), "PAPI_A", reference_points=None
    )
    with_light_only = MeasurementCollector.compute_transition_angles_from_chromacity(
        frames, "PAPI_A", reference_points={"PAPI_A": LIGHT}
    )

    for key in (
        "transition_angle_min_touchpoint",
        "transition_angle_middle_touchpoint",
        "transition_angle_max_touchpoint",
    ):
        assert key not in without_ref
        assert key not in with_light_only

    # the light-referenced verdicts are byte-identical with vs without the reference set
    for key in ("transition_angle_min", "transition_angle_middle", "transition_angle_max"):
        assert without_ref[key] == with_light_only[key]


def test_coincident_touchpoint_matches_light_referenced():
    """a TOUCH_POINT at the light position yields touchpoint angles equal to the light ones."""
    result = MeasurementCollector.compute_transition_angles_from_chromacity(
        _blob(), "PAPI_A", reference_points={"PAPI_A": LIGHT, "TOUCH_POINT": LIGHT}
    )
    assert "transition_angle_middle_touchpoint" in result
    assert result["transition_angle_min_touchpoint"] == result["transition_angle_min"]
    assert result["transition_angle_max_touchpoint"] == result["transition_angle_max"]
    assert result["transition_angle_middle_touchpoint"] == result["transition_angle_middle"]


def test_displaced_touchpoint_differs_from_light_referenced():
    """a displaced TOUCH_POINT (the LZIB case) re-projects to different transition angles."""
    result = MeasurementCollector.compute_transition_angles_from_chromacity(
        _blob(), "PAPI_A", reference_points={"PAPI_A": LIGHT, "TOUCH_POINT": TOUCH_DISPLACED}
    )
    assert "transition_angle_middle_touchpoint" in result
    tp_min = result["transition_angle_min_touchpoint"]
    tp_mid = result["transition_angle_middle_touchpoint"]
    tp_max = result["transition_angle_max_touchpoint"]
    assert tp_min <= tp_mid <= tp_max
    # displaced datum -> the touchpoint reading is not the light-referenced reading
    assert tp_mid != result["transition_angle_middle"]
