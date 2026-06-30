"""wayline dispatch model - mission to field-hub wayline mapping."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base

# dispatch lifecycle - DISPATCHED today; flight-task tracking values land with media return
DISPATCH_STATUS_DISPATCHED = "DISPATCHED"


class WaylineDispatch(Base):
    """one mission's wayline in the field hub's route library.

    mission_id is unique so a re-dispatch updates the existing record in
    place - the wayline uuid stays stable and pilot 2 sees an updated route
    instead of a duplicate.
    """

    __tablename__ = "wayline_dispatch"

    id = Column(UUID, primary_key=True, default=uuid4)
    mission_id = Column(
        UUID,
        ForeignKey("mission.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    # stable wayline uuid presented to pilot's route library
    wayline_id = Column(UUID, nullable=False, default=uuid4)
    # target device serial - null until a flight execution binds one (media return)
    device_sn = Column(String, nullable=True)
    status = Column(String(20), nullable=False, default=DISPATCH_STATUS_DISPATCHED)
    dispatched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mission = relationship("Mission", foreign_keys=[mission_id])

    def mark_dispatched(self) -> None:
        """refresh the record for a (re-)dispatch - status reset, timestamp bumped."""
        self.status = DISPATCH_STATUS_DISPATCHED
        self.dispatched_at = datetime.now(timezone.utc)
