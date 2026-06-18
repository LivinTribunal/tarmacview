"""measurement repository port - the narrow seam that keeps the db swappable.

access stays the lowest common denominator (get-by-id, list-by-inspection, save,
delete) so both the sqlalchemy adapter built now and a future dynamodb adapter can
satisfy it without the domain, service, or engine changing. see
TARMACVIEW-MERGE-PLAN.md D3/§6.
"""

from abc import ABC, abstractmethod
from uuid import UUID

from app.core.enums import MeasurementStatus
from app.domain.measurement.entities import Measurement


class MeasurementRepository(ABC):
    """persistence port for the measurement aggregate."""

    @abstractmethod
    def get_by_id(self, measurement_id: UUID) -> Measurement | None:
        """load one measurement aggregate, or None when it does not exist."""

    @abstractmethod
    def list_by_inspection(self, inspection_id: UUID) -> list[Measurement]:
        """all measurements for one inspection, newest first."""

    @abstractmethod
    def list_by_inspections(self, inspection_ids: list[UUID]) -> list[Measurement]:
        """all measurements across many inspections, newest first (one batched read)."""

    @abstractmethod
    def list_by_statuses(self, statuses: list[MeasurementStatus]) -> list[Measurement]:
        """all measurements currently in any of the given statuses (one read)."""

    @abstractmethod
    def save(self, measurement: Measurement) -> Measurement:
        """insert or update one aggregate and return the persisted form."""

    @abstractmethod
    def delete(self, measurement_id: UUID) -> None:
        """delete one aggregate by id - a no-op when it does not exist."""
