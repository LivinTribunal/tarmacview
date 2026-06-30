"""measurement orm row - one inspection's video-measurement run.

owns the run's status machine, per-light scoring, and the engine reference-point
snapshot shape. the heavy per-frame results blob never lands here - ``object_key``
points at the gzipped json in object storage. reference points / boxes / summaries
are plain dict lists in their jsonb columns (``measurement_service`` builds them).
"""

from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base
from app.core.enums import MeasurementStatus, enum_check_values

_MEASUREMENT_STATUS_VALUES = enum_check_values(MeasurementStatus)

# the four PAPI light slots, left-to-right, the engine keys its output on.
PAPI_LIGHT_NAMES: tuple[str, ...] = ("PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D")

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


class MeasurementError(Exception):
    """raised on an illegal measurement state transition."""


class Measurement(Base):
    """one inspection's measurement run - metadata + object-storage pointers."""

    __tablename__ = "measurement"

    id = Column(UUID, primary_key=True, default=uuid4)
    inspection_id = Column(UUID, ForeignKey("inspection.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, default=MeasurementStatus.QUEUED.value)
    # operator-supplied free-text run name; null falls back to the inspection label
    label = Column(String, nullable=True)
    runway_heading = Column(Float, nullable=True)
    # snapshotted configured glide slope (deg) off the inspection's AGL, captured at
    # create time - an audit record, not a live join (mirrors reference_points).
    glide_slope_angle = Column(Float, nullable=True)
    # snapshotted inspection glide_slope_angle_tolerance (deg) at create time.
    glide_slope_angle_tolerance = Column(Float, nullable=True)
    # snapshotted LHA ground truth - an audit record, not a live join
    reference_points = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # operator-confirmed first-frame light boxes (percentage coords)
    light_boxes = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # per-light PASS/FAIL rollup vs setting_angle +/- tolerance
    summaries = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # ordered input video object keys pulled from the inspection's media
    media_object_keys = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # pointer to the extracted first-frame image in object storage
    first_frame_object_key = Column(String, nullable=True)
    # pointer to the gzipped results json in object storage
    object_key = Column(String, nullable=True)
    # annotated video object keys keyed by light name + enhanced/combined
    annotated_video_keys = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_MEASUREMENT_STATUS_VALUES})",
            name="ck_measurement_status",
        ),
        Index("ix_measurement_inspection_id", "inspection_id"),
    )

    def transition_to(self, target: MeasurementStatus) -> None:
        """advance status through the state machine - raises on an illegal hop."""
        current = MeasurementStatus(self.status)
        if target not in _TRANSITIONS.get(current, set()):
            raise MeasurementError(
                f"illegal measurement transition {current.value} -> {target.value}"
            )
        self.status = target.value
        if target != MeasurementStatus.ERROR:
            self.error_message = None

    def fail(self, message: str) -> None:
        """move to ERROR from any non-terminal state, recording the reason."""
        self.transition_to(MeasurementStatus.ERROR)
        self.error_message = message

    def confirm_boxes(self, boxes: list[dict]) -> None:
        """persist operator-adjusted light boxes ahead of full processing."""
        self.light_boxes = list(boxes)

    def reference_point_payload(self) -> dict[str, dict]:
        """reference points keyed by light name, the shape the engine consumes."""
        return {
            rp["light_name"]: {
                "latitude": rp.get("latitude"),
                "longitude": rp.get("longitude"),
                "elevation_wgs84": rp.get("elevation"),
                "nominal_angle": rp.get("setting_angle"),
                "tolerance": rp.get("tolerance"),
            }
            for rp in (self.reference_points or [])
        }

    def glide_slope_within_tolerance(self, measured_angle: float | None) -> bool | None:
        """measured glidepath within tolerance of the snapshotted configured glide slope.

        None (unscoreable) when the configured angle, tolerance, or measurement is missing.
        """
        if (
            self.glide_slope_angle is None
            or self.glide_slope_angle_tolerance is None
            or measured_angle is None
        ):
            return None
        return abs(measured_angle - self.glide_slope_angle) <= self.glide_slope_angle_tolerance

    @staticmethod
    def score_light(
        light_name: str,
        setting_angle: float | None,
        tolerance: float | None,
        measured_transition_angle: float | None,
    ) -> dict:
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
        return {
            "light_name": light_name,
            "setting_angle": setting_angle,
            "tolerance": tolerance,
            "measured_transition_angle": measured_transition_angle,
            "passed": passed,
        }

    def with_summaries_from(self, measured: dict[str, float | None]) -> None:
        """rebuild per-light summaries from measured transition angles by light name."""
        by_name = {rp["light_name"]: rp for rp in (self.reference_points or [])}
        summaries: list[dict] = []
        for name in PAPI_LIGHT_NAMES:
            rp = by_name.get(name)
            if rp is None:
                continue
            summaries.append(
                self.score_light(
                    name, rp.get("setting_angle"), rp.get("tolerance"), measured.get(name)
                )
            )
        self.summaries = summaries
