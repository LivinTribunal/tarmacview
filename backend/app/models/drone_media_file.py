"""drone media file - originals returned from the aircraft via the field hub."""

from uuid import UUID as PyUUID
from uuid import uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base
from app.core.enums import MediaFileStatus, enum_check_values
from app.core.exceptions import DomainError

# enum values rendered inline into CheckConstraint bodies so schema stays in
# sync when a new member is added to the python enum.
_MEDIA_FILE_STATUS_VALUES = enum_check_values(MediaFileStatus)


class DroneMediaFile(Base):
    """one uploaded original reported by the field hub, keyed by dji fingerprint."""

    __tablename__ = "drone_media_file"

    id = Column(UUID, primary_key=True, default=uuid4)
    object_key = Column(String, nullable=False)
    fingerprint = Column(String, nullable=False, unique=True)
    # device-reported capture time - never server receive time
    captured_at = Column(DateTime(timezone=True), nullable=True)
    capture_position = Column(String, nullable=True)
    device_sn = Column(String, nullable=True)
    # null while unmatched - set by mission matching or manual assignment
    mission_id = Column(UUID, ForeignKey("mission.id", ondelete="SET NULL"), nullable=True)
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
        Index("ix_drone_media_file_mission_id", "mission_id"),
        Index("ix_drone_media_file_device_sn", "device_sn"),
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
