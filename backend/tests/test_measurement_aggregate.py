"""measurement orm model - state machine, scoring, summary rollup (no db flush)."""

from uuid import uuid4

import pytest

from app.core.enums import MeasurementStatus
from app.models.measurement import Measurement, MeasurementError


def _measurement(*, status=MeasurementStatus.QUEUED, **kw) -> Measurement:
    """a fresh measurement row for one inspection (status set explicitly, no flush)."""
    value = status.value if isinstance(status, MeasurementStatus) else status
    return Measurement(inspection_id=uuid4(), status=value, **kw)


# state machine


def test_legal_happy_path_transitions():
    """queued -> first_frame -> awaiting_confirm -> processing -> done is legal."""
    m = _measurement()
    for target in (
        MeasurementStatus.FIRST_FRAME,
        MeasurementStatus.AWAITING_CONFIRM,
        MeasurementStatus.PROCESSING,
        MeasurementStatus.DONE,
    ):
        m.transition_to(target)
        assert m.status == target


def test_first_frame_can_auto_confirm_to_processing():
    """a confident detection skips the manual gate: first_frame -> processing is legal."""
    m = _measurement(status=MeasurementStatus.FIRST_FRAME)
    m.transition_to(MeasurementStatus.PROCESSING)
    assert m.status == MeasurementStatus.PROCESSING


def test_illegal_skip_raises():
    """queued cannot jump straight to processing."""
    m = _measurement()
    with pytest.raises(MeasurementError):
        m.transition_to(MeasurementStatus.PROCESSING)


def test_done_is_terminal():
    """a finished run rejects further transitions."""
    m = _measurement(status=MeasurementStatus.DONE)
    with pytest.raises(MeasurementError):
        m.transition_to(MeasurementStatus.PROCESSING)


def test_error_reachable_from_any_non_terminal_state():
    """every working state can fail to ERROR."""
    for start in (
        MeasurementStatus.QUEUED,
        MeasurementStatus.FIRST_FRAME,
        MeasurementStatus.AWAITING_CONFIRM,
        MeasurementStatus.PROCESSING,
    ):
        m = _measurement(status=start)
        m.transition_to(MeasurementStatus.ERROR)
        assert m.status == MeasurementStatus.ERROR


def test_error_is_terminal():
    """an errored run does not transition further."""
    m = _measurement(status=MeasurementStatus.ERROR)
    with pytest.raises(MeasurementError):
        m.transition_to(MeasurementStatus.PROCESSING)


def test_fail_records_message_and_clears_on_recovery_path():
    """fail() moves to ERROR and stores the reason."""
    m = _measurement(status=MeasurementStatus.PROCESSING)
    m.fail("engine blew up")
    assert m.status == MeasurementStatus.ERROR
    assert m.error_message == "engine blew up"


def test_transition_clears_stale_error_message():
    """a non-error transition wipes a previous error message."""
    m = _measurement(status=MeasurementStatus.QUEUED, error_message="stale")
    m.transition_to(MeasurementStatus.FIRST_FRAME)
    assert m.error_message is None


# reference points + scoring


def test_reference_point_payload_shape():
    """the engine payload keys each ref point by light name with nominal angle."""
    m = _measurement(
        reference_points=[
            {
                "light_name": "PAPI_A",
                "latitude": 50.1,
                "longitude": 14.2,
                "elevation": 380.0,
                "setting_angle": 3.0,
                "tolerance": 0.5,
            }
        ]
    )
    payload = m.reference_point_payload()
    assert payload["PAPI_A"]["nominal_angle"] == 3.0
    assert payload["PAPI_A"]["latitude"] == 50.1
    assert payload["PAPI_A"]["elevation_wgs84"] == 380.0


def test_score_light_pass_fail_unknown():
    """within tolerance passes, outside fails, missing data is unknown."""
    ok = Measurement.score_light("PAPI_A", 3.0, 0.5, 3.2)
    bad = Measurement.score_light("PAPI_B", 3.0, 0.5, 4.0)
    unknown = Measurement.score_light("PAPI_C", 3.0, 0.5, None)
    no_truth = Measurement.score_light("PAPI_D", None, None, 3.0)
    assert ok["passed"] is True
    assert bad["passed"] is False
    assert unknown["passed"] is None
    assert no_truth["passed"] is None


def test_with_summaries_from_rolls_up_by_light_name():
    """summaries are built only for lights that have a reference point."""
    m = _measurement(
        reference_points=[
            {
                "light_name": "PAPI_A",
                "latitude": 50.1,
                "longitude": 14.2,
                "elevation": 380.0,
                "setting_angle": 3.0,
                "tolerance": 0.5,
            },
            {
                "light_name": "PAPI_B",
                "latitude": 50.1,
                "longitude": 14.2,
                "elevation": 380.0,
                "setting_angle": 3.0,
                "tolerance": 0.5,
            },
        ]
    )
    m.with_summaries_from({"PAPI_A": 3.1, "PAPI_B": 4.5})
    by_name = {s["light_name"]: s for s in m.summaries}
    assert len(m.summaries) == 2
    assert by_name["PAPI_A"]["passed"] is True
    assert by_name["PAPI_B"]["passed"] is False


# glide-slope tolerance verdict


def test_glide_slope_within_tolerance_pass_fail():
    """measured glidepath inside the band passes, outside fails."""
    m = _measurement(glide_slope_angle=3.0, glide_slope_angle_tolerance=0.2)
    assert m.glide_slope_within_tolerance(3.0) is True
    assert m.glide_slope_within_tolerance(3.15) is True  # within the band
    assert m.glide_slope_within_tolerance(2.85) is True  # within the band, other side
    assert m.glide_slope_within_tolerance(3.3) is False


def test_glide_slope_within_tolerance_unscoreable():
    """a missing configured angle, tolerance, or measurement is None (unscoreable)."""
    assert (
        _measurement(
            glide_slope_angle=None, glide_slope_angle_tolerance=0.1
        ).glide_slope_within_tolerance(3.0)
        is None
    )
    assert (
        _measurement(
            glide_slope_angle=3.0, glide_slope_angle_tolerance=None
        ).glide_slope_within_tolerance(3.0)
        is None
    )
    assert (
        _measurement(
            glide_slope_angle=3.0, glide_slope_angle_tolerance=0.1
        ).glide_slope_within_tolerance(None)
        is None
    )


def test_confirm_boxes_replaces_boxes():
    """confirm_boxes stores the operator-adjusted set."""
    m = _measurement()
    m.confirm_boxes([{"light_name": "PAPI_A", "x": 10.0, "y": 50.0, "size": 8.0}])
    assert len(m.light_boxes) == 1
    assert m.light_boxes[0]["light_name"] == "PAPI_A"
