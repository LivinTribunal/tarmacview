"""drone media file - originals from the field hub or manual per-inspection upload."""

from uuid import UUID as PyUUID
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base
from app.core.enums import MediaFileStatus, MediaOrigin, enum_check_values
from app.core.exceptions import DomainError

# enum values rendered inline into CheckConstraint bodies so schema stays in
# sync when a new member is added to the python enum.
_MEDIA_FILE_STATUS_VALUES = enum_check_values(MediaFileStatus)
_MEDIA_ORIGIN_VALUES = enum_check_values(MediaOrigin)


class DroneMediaFile(Base):
    """one uploaded original - hub-reported (keyed by fingerprint) or a manual upload."""

    __tablename__ = "drone_media_file"

    id = Column(UUID, primary_key=True, default=uuid4)
    object_key = Column(String, nullable=False)
    # null for manual uploads - only hub rows carry the dji idempotency key
    fingerprint = Column(String, nullable=True)
    # device-reported capture time - never server receive time
    captured_at = Column(DateTime(timezone=True), nullable=True)
    capture_position = Column(String, nullable=True)
    device_sn = Column(String, nullable=True)
    # null while unmatched - set by mission matching or manual assignment
    mission_id = Column(UUID, ForeignKey("mission.id", ondelete="SET NULL"), nullable=True)
    # null until attached to an inspection in the per-inspection upload form
    inspection_id = Column(UUID, ForeignKey("inspection.id", ondelete="SET NULL"), nullable=True)
    # dense 1..N ordinal within the parent inspection - owned by drone_media_service
    order_index = Column(Integer, nullable=True)
    origin = Column(String(20), nullable=False, default=MediaOrigin.HUB.value)
    # operator-facing name; size for the upload listing
    filename = Column(String, nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    status = Column(String(20), nullable=False, default=MediaFileStatus.RECEIVED.value)
    # hub callback payload persisted verbatim
    raw_callback = Column(JSONB, nullable=True)
    received_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # audit trail for matching + manual reassignment
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"status IN ({_MEDIA_FILE_STATUS_VALUES})",
            name="ck_drone_media_file_status",
        ),
        CheckConstraint(
            f"origin IN ({_MEDIA_ORIGIN_VALUES})",
            name="ck_drone_media_file_origin",
        ),
        CheckConstraint(
            "order_index > 0",
            name="ck_drone_media_file_order_positive",
        ),
        # inspection assignment and order travel together - both set or both null
        CheckConstraint(
            "(inspection_id IS NULL) = (order_index IS NULL)",
            name="ck_drone_media_file_order_inspection",
        ),
        # hub idempotency: at most one row per fingerprint, but manual rows
        # (null fingerprint) coexist freely - a partial index, not a column UNIQUE
        Index(
            "uq_drone_media_file_fingerprint",
            "fingerprint",
            unique=True,
            postgresql_where=text("fingerprint IS NOT NULL"),
        ),
        UniqueConstraint(
            "inspection_id", "order_index", name="uq_drone_media_file_inspection_order"
        ),
        Index("ix_drone_media_file_mission_id", "mission_id"),
        Index("ix_drone_media_file_inspection_id", "inspection_id"),
        Index("ix_drone_media_file_device_sn", "device_sn"),
    )

    @staticmethod
    def validate_order_target(target: int, n: int) -> None:
        """validate a target order_index sits in 1..n for the parent inspection."""
        if target < 1 or target > n:
            raise DomainError(
                f"order_index must be between 1 and {n}",
                status_code=422,
            )

    def _block_after_ingest(self) -> None:
        """raise 409 when the file already left for the processing pipeline."""
        if self.status == MediaFileStatus.INGESTED.value:
            raise DomainError(
                "media file already ingested - reassignment is blocked", status_code=409
            )

    def assign_to_mission(self, mission_id: PyUUID) -> None:
        """attach the file to a mission - auto-match and manual reassign both land here."""
        self._block_after_ingest()
        self.mission_id = mission_id
        self.status = MediaFileStatus.MATCHED.value

    def mark_unassigned(self) -> None:
        """park the file in the unassigned bucket for manual assignment."""
        self._block_after_ingest()
        self.mission_id = None
        self.status = MediaFileStatus.UNASSIGNED.value

    def mark_ingested(self) -> bool:
        """hand the file to the processing pipeline - true when newly ingested.

        idempotent: an already-INGESTED row is a no-op returning false.
        """
        if self.status == MediaFileStatus.INGESTED.value:
            return False
        self.status = MediaFileStatus.INGESTED.value
        return True
