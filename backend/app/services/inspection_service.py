"""inspection add / update / delete / reorder via the mission aggregate, with lha-selection."""

from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import InspectionMethod
from app.core.exceptions import DomainError, NotFoundError
from app.models.airport import AirfieldSurface
from app.models.inspection import Inspection, InspectionConfiguration, InspectionTemplate
from app.models.mission import Mission
from app.schemas.mission import InspectionCreate, InspectionUpdate
from app.services.geometry_converter import apply_dict_update
from app.services.lha_selection import apply_lha_selection
from app.services.trajectory.helpers import check_missing_setting_angles


def _get_mission(db: Session, mission_id: UUID, for_update: bool = False) -> Mission:
    """get mission or raise NotFoundError."""
    if for_update:
        # lock the row first, then load relationships with populate_existing
        db.query(Mission).filter(Mission.id == mission_id).with_for_update().first()

    mission = (
        db.query(Mission)
        .options(joinedload(Mission.inspections), joinedload(Mission.flight_plan))
        .filter(Mission.id == mission_id)
        .execution_options(populate_existing=True)
        .first()
    )
    if not mission:
        raise NotFoundError("mission not found")

    return mission


def _check_papi_setting_angles(
    template: InspectionTemplate,
    method: str | InspectionMethod,
    config_data: dict | None,
) -> None:
    """raise DomainError(422) when PAPI angle source needs setting angles missing on LHAs."""
    if not config_data:
        return
    method_val = method.value if isinstance(method, InspectionMethod) else method
    if method_val != InspectionMethod.VERTICAL_PROFILE.value:
        return
    if (config_data.get("angle_source") or "").upper() != "PAPI":
        return
    lha_ids = config_data.get("lha_ids")
    missing = check_missing_setting_angles(template, lha_ids)
    if missing:
        units = ", ".join(missing)
        raise DomainError(
            f"PAPI mode requires setting angles on LHA unit(s): {units}",
            status_code=422,
        )


def _check_scan_surface(
    db: Session,
    mission: Mission,
    method: str | InspectionMethod,
    config_data: dict | None,
) -> None:
    """raise DomainError(422) when a surface scan targets a surface off the mission's airport."""
    if not config_data:
        return
    method_val = method.value if isinstance(method, InspectionMethod) else method
    if method_val != InspectionMethod.SURFACE_SCAN.value:
        return
    surface_id = config_data.get("scan_surface_id")
    if surface_id is None:
        return
    surface = (
        db.query(AirfieldSurface)
        .filter(
            AirfieldSurface.id == surface_id,
            AirfieldSurface.airport_id == mission.airport_id,
        )
        .first()
    )
    if surface is None:
        raise DomainError(
            "scan surface must belong to the mission's airport",
            status_code=422,
        )


def add_inspection(db: Session, mission_id: UUID, schema: InspectionCreate) -> Inspection:
    """add inspection to mission via aggregate root."""
    mission = _get_mission(db, mission_id, for_update=True)

    template = (
        db.query(InspectionTemplate)
        .options(joinedload(InspectionTemplate.targets))
        .filter(InspectionTemplate.id == schema.template_id)
        .first()
    )
    if not template:
        raise NotFoundError("template not found")

    config_data = schema.config.model_dump(mode="json", by_alias=True) if schema.config else None
    config_id = None

    if config_data:
        apply_lha_selection(db, config_data)
        _check_papi_setting_angles(template, schema.method, config_data)
        _check_scan_surface(db, mission, schema.method, config_data)
        config = InspectionConfiguration(**config_data)
        db.add(config)
        db.flush()
        config_id = config.id

    next_order = (
        db.query(func.coalesce(func.max(Inspection.sequence_order), 0) + 1)
        .filter(Inspection.mission_id == mission_id)
        .scalar()
    )

    inspection = Inspection(
        template_id=schema.template_id,
        method=schema.method,
        config_id=config_id,
        sequence_order=next_order,
    )

    try:
        mission.add_inspection(inspection)
    except ValueError as e:
        raise DomainError(str(e), status_code=409)

    db.flush()
    db.refresh(inspection)

    return inspection


def update_inspection(
    db: Session, mission_id: UUID, inspection_id: UUID, schema: InspectionUpdate
) -> Inspection:
    """update inspection config/sequence/method."""
    mission = _get_mission(db, mission_id)
    inspection = (
        db.query(Inspection)
        .options(
            joinedload(Inspection.config),
            joinedload(Inspection.template).joinedload(InspectionTemplate.targets),
        )
        .filter(Inspection.id == inspection_id, Inspection.mission_id == mission_id)
        .first()
    )
    if not inspection:
        raise NotFoundError("inspection not found")

    data = schema.model_dump(exclude_unset=True)
    data.pop("config", None)
    config_data = (
        schema.config.model_dump(mode="json", exclude_unset=True, by_alias=True)
        if schema.config
        else None
    )

    if config_data:
        # if rules came in but the caller did not also resend lha_ids, fall back
        # to the saved set so CUSTOM-mode AGLs still resolve against the
        # canonical custom selection.
        if "lha_selection_rules" in config_data and "lha_ids" not in config_data:
            config_data["lha_ids"] = list(inspection.config.lha_ids if inspection.config else [])
        apply_lha_selection(db, config_data)

        # for PAPI-mode validation, evaluate against the new method (if changed)
        # and the merged lha_ids - missing rows fall back to the saved config.
        effective_method = data.get("method") or inspection.method
        merged = dict(config_data)
        if "lha_ids" not in merged and inspection.config:
            merged["lha_ids"] = list(inspection.config.lha_ids or [])
        if "angle_source" not in merged and inspection.config:
            merged["angle_source"] = inspection.config.angle_source
        _check_papi_setting_angles(inspection.template, effective_method, merged)
        _check_scan_surface(db, mission, effective_method, config_data)

        if inspection.config:
            apply_dict_update(inspection.config, config_data)
        else:
            config = InspectionConfiguration(**config_data)
            db.add(config)
            db.flush()
            inspection.config_id = config.id

    try:
        mission.modify_inspections(lambda: apply_dict_update(inspection, data))
    except ValueError as e:
        raise DomainError(str(e), status_code=409)

    db.flush()
    db.refresh(inspection)

    return inspection


def delete_inspection(db: Session, mission_id: UUID, inspection_id: UUID):
    """delete inspection and reorder remaining."""
    mission = _get_mission(db, mission_id)

    try:
        mission.remove_inspection(inspection_id)
    except ValueError as e:
        msg = str(e)
        # distinguish terminal-state refusal (409) from missing id (404)
        if "not found" in msg:
            raise NotFoundError("inspection not found")
        raise DomainError(msg, status_code=409)

    db.flush()

    # reorder remaining
    remaining = (
        db.query(Inspection)
        .filter(Inspection.mission_id == mission_id)
        .order_by(Inspection.sequence_order)
        .all()
    )
    for i, insp in enumerate(remaining, start=1):
        insp.sequence_order = i

    db.flush()


def reorder_inspections(db: Session, mission_id: UUID, inspection_ids: list[UUID]):
    """reorder inspections by provided id list."""
    mission = _get_mission(db, mission_id)

    # validate inspection_ids matches mission inspections exactly
    existing_ids = {insp.id for insp in mission.inspections}
    provided_ids = set(inspection_ids)
    if existing_ids != provided_ids:
        missing = existing_ids - provided_ids
        extra = provided_ids - existing_ids
        parts = []
        if missing:
            parts.append(f"missing: {sorted(str(i) for i in missing)}")
        if extra:
            parts.append(f"unknown: {sorted(str(i) for i in extra)}")
        raise DomainError(f"inspection_ids mismatch - {', '.join(parts)}", status_code=400)

    def apply_reorder():
        """apply new sequence_order to each inspection."""
        for i, insp_id in enumerate(inspection_ids, start=1):
            inspection = (
                db.query(Inspection)
                .filter(Inspection.id == insp_id, Inspection.mission_id == mission_id)
                .first()
            )
            if not inspection:
                raise NotFoundError(f"inspection {insp_id} not found")

            inspection.sequence_order = i

    try:
        mission.modify_inspections(apply_reorder)
    except ValueError as e:
        raise DomainError(str(e), status_code=409)

    db.flush()
