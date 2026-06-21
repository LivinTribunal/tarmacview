"""measurement orm row - a dumb data holder for the sqlalchemy adapter only.

all measurement business logic lives on the domain aggregate
(``app.domain.measurement.entities.Measurement``); this table just persists it.
the heavy per-frame results blob never lands here - ``object_key`` points at the
gzipped json in object storage. reference points are snapshotted at create time.
"""

from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base
from app.core.enums import MeasurementStatus, enum_check_values

_MEASUREMENT_STATUS_VALUES = enum_check_values(MeasurementStatus)


class Measurement(Base):
    """one inspection's measurement run - metadata + object-storage pointers."""

    __tablename__ = "measurement"

    id = Column(UUID, primary_key=True, default=uuid4)
    inspection_id = Column(UUID, ForeignKey("inspection.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, default=MeasurementStatus.QUEUED.value)
    # operator-supplied free-text run name; null falls back to the inspection label
    label = Column(String, nullable=True)
    runway_heading = Column(Float, nullable=True)
    # iteration grouping - linked re-flies of the same inspection share a group;
    # the root run is its own group (group = id, index 1), each re-fly is max + 1
    iteration_group_id = Column(UUID, nullable=True)
    iteration_index = Column(Integer, nullable=True)
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
        Index("ix_measurement_iteration_group_id", "iteration_group_id"),
    )
