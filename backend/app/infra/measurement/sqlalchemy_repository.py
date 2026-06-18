"""sqlalchemy adapter #1 for the measurement port - the only place orm meets domain.

maps the domain ``Measurement`` aggregate to/from the ``measurement`` table. swapping
to a dynamodb adapter later is one new class implementing the same port; the domain,
service, and engine never change. follows the services-flush-routes-commit rule:
``save`` flushes, the route commits.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from app.domain.measurement.entities import (
    LightBox,
    LightSummary,
    Measurement,
    ReferencePoint,
)
from app.domain.measurement.repository import MeasurementRepository
from app.models.measurement import Measurement as MeasurementORM


def _ref_to_dict(rp: ReferencePoint) -> dict:
    """serialize one reference point for jsonb storage."""
    return {
        "light_name": rp.light_name,
        "latitude": rp.latitude,
        "longitude": rp.longitude,
        "elevation": rp.elevation,
        "lha_id": str(rp.lha_id) if rp.lha_id else None,
        "unit_designator": rp.unit_designator,
        "setting_angle": rp.setting_angle,
        "tolerance": rp.tolerance,
    }


def _ref_from_dict(d: dict) -> ReferencePoint:
    """rebuild one reference point from its jsonb form."""
    lha_id = d.get("lha_id")
    return ReferencePoint(
        light_name=d["light_name"],
        latitude=d["latitude"],
        longitude=d["longitude"],
        elevation=d["elevation"],
        lha_id=UUID(lha_id) if lha_id else None,
        unit_designator=d.get("unit_designator"),
        setting_angle=d.get("setting_angle"),
        tolerance=d.get("tolerance"),
    )


def _box_to_dict(b: LightBox) -> dict:
    """serialize one light box."""
    return {"light_name": b.light_name, "x": b.x, "y": b.y, "size": b.size}


def _box_from_dict(d: dict) -> LightBox:
    """rebuild one light box."""
    return LightBox(light_name=d["light_name"], x=d["x"], y=d["y"], size=d["size"])


def _summary_to_dict(s: LightSummary) -> dict:
    """serialize one per-light summary."""
    return {
        "light_name": s.light_name,
        "setting_angle": s.setting_angle,
        "tolerance": s.tolerance,
        "measured_transition_angle": s.measured_transition_angle,
        "passed": s.passed,
    }


def _summary_from_dict(d: dict) -> LightSummary:
    """rebuild one per-light summary."""
    return LightSummary(
        light_name=d["light_name"],
        setting_angle=d.get("setting_angle"),
        tolerance=d.get("tolerance"),
        measured_transition_angle=d.get("measured_transition_angle"),
        passed=d.get("passed"),
    )


def _to_domain(row: MeasurementORM) -> Measurement:
    """map an orm row to the domain aggregate."""
    from app.core.enums import MeasurementStatus

    return Measurement(
        id=row.id,
        inspection_id=row.inspection_id,
        status=MeasurementStatus(row.status),
        label=row.label,
        runway_heading=row.runway_heading,
        reference_points=[_ref_from_dict(d) for d in (row.reference_points or [])],
        light_boxes=[_box_from_dict(d) for d in (row.light_boxes or [])],
        summaries=[_summary_from_dict(d) for d in (row.summaries or [])],
        media_object_keys=list(row.media_object_keys or []),
        first_frame_object_key=row.first_frame_object_key,
        object_key=row.object_key,
        annotated_video_keys=dict(row.annotated_video_keys or {}),
        error_message=row.error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _apply_to_row(row: MeasurementORM, m: Measurement) -> None:
    """copy domain field values onto an orm row (insert or update)."""
    row.inspection_id = m.inspection_id
    row.status = m.status.value
    row.label = m.label
    row.runway_heading = m.runway_heading
    row.reference_points = [_ref_to_dict(rp) for rp in m.reference_points]
    row.light_boxes = [_box_to_dict(b) for b in m.light_boxes]
    row.summaries = [_summary_to_dict(s) for s in m.summaries]
    row.media_object_keys = list(m.media_object_keys)
    row.first_frame_object_key = m.first_frame_object_key
    row.object_key = m.object_key
    row.annotated_video_keys = dict(m.annotated_video_keys)
    row.error_message = m.error_message


class SqlAlchemyMeasurementRepository(MeasurementRepository):
    """postgres-backed measurement repository."""

    def __init__(self, db: Session):
        """bind the adapter to the caller's session - the service owns commits."""
        self.db = db

    def get_by_id(self, measurement_id: UUID) -> Measurement | None:
        """load one measurement aggregate, or None when it does not exist."""
        row = self.db.query(MeasurementORM).filter(MeasurementORM.id == measurement_id).first()
        return _to_domain(row) if row else None

    def list_by_inspection(self, inspection_id: UUID) -> list[Measurement]:
        """all measurements for one inspection, newest first."""
        rows = (
            self.db.query(MeasurementORM)
            .filter(MeasurementORM.inspection_id == inspection_id)
            .order_by(MeasurementORM.created_at.desc(), MeasurementORM.id)
            .all()
        )
        return [_to_domain(r) for r in rows]

    def list_by_inspections(self, inspection_ids: list[UUID]) -> list[Measurement]:
        """all measurements across many inspections, newest first (one batched read)."""
        if not inspection_ids:
            return []
        rows = (
            self.db.query(MeasurementORM)
            .filter(MeasurementORM.inspection_id.in_(inspection_ids))
            .order_by(MeasurementORM.created_at.desc(), MeasurementORM.id)
            .all()
        )
        return [_to_domain(r) for r in rows]

    def list_by_statuses(self, statuses):
        """all measurements currently in any of the given statuses (one read)."""
        if not statuses:
            return []
        values = [s.value for s in statuses]
        rows = (
            self.db.query(MeasurementORM)
            .filter(MeasurementORM.status.in_(values))
            .order_by(MeasurementORM.created_at)
            .all()
        )
        return [_to_domain(r) for r in rows]

    def save(self, measurement: Measurement) -> Measurement:
        """upsert one aggregate, flush, and return the persisted form."""
        row = self.db.query(MeasurementORM).filter(MeasurementORM.id == measurement.id).first()
        if row is None:
            row = MeasurementORM(id=measurement.id)
            _apply_to_row(row, measurement)
            self.db.add(row)
        else:
            _apply_to_row(row, measurement)
        self.db.flush()
        self.db.refresh(row)
        return _to_domain(row)

    def delete(self, measurement_id: UUID) -> None:
        """delete one measurement row by id, flush - a no-op when it's gone."""
        row = self.db.query(MeasurementORM).filter(MeasurementORM.id == measurement_id).first()
        if row is not None:
            self.db.delete(row)
            self.db.flush()
