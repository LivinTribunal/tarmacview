"""measurement domain objects - pure python, no orm, no db, no engine deps.

these are the verification half of the plan->fly->measure->verify loop: a
``Measurement`` scores an inspection's flown PAPI footage against the snapshotted
``LHA`` ground truth. persistence lives behind ``MeasurementRepository``; the heavy
results blob lives in object storage and is referenced here only by ``object_key``.
"""

from dataclasses import dataclass, field, replace
from datetime import datetime
from uuid import UUID, uuid4

from app.core.enums import MeasurementStatus

# legal forward transitions; ERROR is reachable from any non-terminal state.
_TRANSITIONS: dict[MeasurementStatus, set[MeasurementStatus]] = {
    MeasurementStatus.QUEUED: {MeasurementStatus.FIRST_FRAME, MeasurementStatus.ERROR},
    MeasurementStatus.FIRST_FRAME: {
        MeasurementStatus.AWAITING_CONFIRM,
        MeasurementStatus.PROCESSING,
        MeasurementStatus.ERROR,
    },
    MeasurementStatus.AWAITING_CONFIRM: {MeasurementStatus.PROCESSING, MeasurementStatus.ERROR},
    MeasurementStatus.PROCESSING: {MeasurementStatus.DONE, MeasurementStatus.ERROR},
    MeasurementStatus.DONE: set(),
    MeasurementStatus.ERROR: set(),
}

# the four PAPI light slots, left-to-right, the engine keys its output on.
PAPI_LIGHT_NAMES: tuple[str, ...] = ("PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D")


class MeasurementError(Exception):
    """raised on an illegal measurement state transition."""


@dataclass(frozen=True)
class ReferencePoint:
    """one PAPI light's ground truth, snapshotted off the inspection's LHA at create.

    a snapshot, not a live join: it records what the spec was when the run started,
    so a later LHA edit can't retroactively change a finished measurement's pass/fail.
    """

    light_name: str
    latitude: float
    longitude: float
    elevation: float
    lha_id: UUID | None = None
    unit_designator: str | None = None
    setting_angle: float | None = None
    tolerance: float | None = None


@dataclass(frozen=True)
class LightBox:
    """a PAPI light's box on the first frame - percentage coords the operator confirms."""

    light_name: str
    x: float
    y: float
    size: float


@dataclass(frozen=True)
class LightSummary:
    """per-light rollup scored against the snapshotted setting angle +/- tolerance."""

    light_name: str
    setting_angle: float | None = None
    tolerance: float | None = None
    measured_transition_angle: float | None = None
    passed: bool | None = None


@dataclass
class FrameMeasurement:
    """one frame's per-light reading - the lightweight shape the timeseries rolls up.

    the full per-frame timeseries is gzipped into object storage; this domain object
    exists so callers (and tests) can reason about a frame without the heavy blob.
    """

    frame_number: int
    timestamp_ms: float
    per_light: dict[str, dict] = field(default_factory=dict)


@dataclass
class Measurement:
    """aggregate root for one inspection's measurement run."""

    inspection_id: UUID
    id: UUID = field(default_factory=uuid4)
    status: MeasurementStatus = MeasurementStatus.QUEUED
    # operator-supplied free-text run name; blank falls back to the inspection label
    label: str | None = None
    runway_heading: float | None = None
    reference_points: list[ReferencePoint] = field(default_factory=list)
    light_boxes: list[LightBox] = field(default_factory=list)
    summaries: list[LightSummary] = field(default_factory=list)
    media_object_keys: list[str] = field(default_factory=list)
    first_frame_object_key: str | None = None
    object_key: str | None = None
    annotated_video_keys: dict[str, str] = field(default_factory=dict)
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    def transition_to(self, target: MeasurementStatus) -> None:
        """advance status through the state machine - raises on an illegal hop."""
        if target not in _TRANSITIONS.get(self.status, set()):
            raise MeasurementError(
                f"illegal measurement transition {self.status.value} -> {target.value}"
            )
        self.status = target
        if target != MeasurementStatus.ERROR:
            self.error_message = None

    def fail(self, message: str) -> None:
        """move to ERROR from any non-terminal state, recording the reason."""
        self.transition_to(MeasurementStatus.ERROR)
        self.error_message = message

    def confirm_boxes(self, boxes: list[LightBox]) -> None:
        """persist operator-adjusted light boxes ahead of full processing."""
        self.light_boxes = list(boxes)

    def reference_point_payload(self) -> dict[str, dict]:
        """reference points keyed by light name, the shape the engine consumes."""
        return {
            rp.light_name: {
                "latitude": rp.latitude,
                "longitude": rp.longitude,
                "elevation_wgs84": rp.elevation,
                "nominal_angle": rp.setting_angle,
                "tolerance": rp.tolerance,
            }
            for rp in self.reference_points
        }

    @staticmethod
    def score_light(
        light_name: str,
        setting_angle: float | None,
        tolerance: float | None,
        measured_transition_angle: float | None,
    ) -> LightSummary:
        """roll a measured transition angle up to PASS/FAIL vs setting +/- tolerance.

        passed is None (unknown) when the ground truth or the measurement is missing -
        an absent setting angle is not a failure, it's an unscoreable light.
        """
        passed: bool | None = None
        if (
            setting_angle is not None
            and tolerance is not None
            and measured_transition_angle is not None
        ):
            passed = abs(measured_transition_angle - setting_angle) <= tolerance
        return LightSummary(
            light_name=light_name,
            setting_angle=setting_angle,
            tolerance=tolerance,
            measured_transition_angle=measured_transition_angle,
            passed=passed,
        )

    def with_summaries_from(self, measured: dict[str, float | None]) -> None:
        """rebuild per-light summaries from measured transition angles by light name."""
        by_name = {rp.light_name: rp for rp in self.reference_points}
        summaries: list[LightSummary] = []
        for name in PAPI_LIGHT_NAMES:
            rp = by_name.get(name)
            if rp is None:
                continue
            summaries.append(
                self.score_light(name, rp.setting_angle, rp.tolerance, measured.get(name))
            )
        self.summaries = summaries

    def copy(self) -> "Measurement":
        """shallow copy for adapter round-trips that must not alias the original."""
        return replace(self)
