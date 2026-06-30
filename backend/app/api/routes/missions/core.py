"""mission CRUD, duplicate, status transitions, export, report."""

import io
import zipfile
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.dependencies import (
    OperatorUser,
    check_mission_access,
)
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse
from app.schemas.drone_media import MissionInspectionMediaResponse
from app.schemas.export import ExportRequest
from app.schemas.mission import (
    MissionDetailResponse,
    MissionResponse,
    MissionUpdate,
)
from app.schemas.wayline_dispatch import DispatchRequest, WaylineDispatchResponse
from app.services import (
    drone_media_service,
    mission_service,
    wayline_dispatch_service,
)
from app.services import (
    export as export_service,
)
from app.services import (
    mission_report as mission_report_service,
)
from app.utils.audit import log_audit

router = APIRouter()


# missions
@router.get("/{mission_id}", response_model=MissionDetailResponse)
def get_mission(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """get mission with inspections."""
    mission = check_mission_access(db, current_user, mission_id)
    return mission


@router.get("/{mission_id}/drone-media", response_model=MissionInspectionMediaResponse)
def list_mission_drone_media(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """mission media grouped by inspection plus the unassigned bucket."""
    check_mission_access(db, current_user, mission_id)
    return drone_media_service.list_mission_media_by_inspection(db, mission_id)


@router.put("/{mission_id}", response_model=MissionResponse)
def update_mission(
    mission_id: UUID,
    body: MissionUpdate,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """update mission."""
    check_mission_access(db, current_user, mission_id)
    mission = mission_service.update_mission(db, mission_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=mission.name,
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return mission


@router.delete("/{mission_id}", response_model=DeleteResponse)
def delete_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """delete mission."""
    mission = check_mission_access(db, current_user, mission_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=mission.name,
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    mission_service.delete_mission(db, mission_id)
    db.commit()

    return DeleteResponse(deleted=True)


@router.post("/{mission_id}/duplicate", status_code=201, response_model=MissionResponse)
def duplicate_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """duplicate mission as new DRAFT."""
    check_mission_access(db, current_user, mission_id)
    copy = mission_service.duplicate_mission(db, mission_id)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Mission",
        entity_id=copy.id,
        entity_name=copy.name,
        details={"duplicated_from": str(mission_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=copy.airport_id,
    )
    db.commit()
    return copy


# status transitions
@router.post("/{mission_id}/validate", response_model=MissionResponse)
def validate_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """PLANNED -> VALIDATED."""
    check_mission_access(db, current_user, mission_id)
    result = mission_service.transition_mission(db, mission_id, "VALIDATED")
    log_audit(
        db,
        current_user,
        AuditAction.VALIDATE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=result.name,
        details={"to": "VALIDATED"},
        ip_address=request.client.host if request.client else None,
        airport_id=result.airport_id,
    )
    db.commit()
    return result


@router.post("/{mission_id}/export")
def export_mission(
    mission_id: UUID,
    body: ExportRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """generate export files and transition VALIDATED -> EXPORTED."""
    mission = check_mission_access(db, current_user, mission_id)
    files, safe_name, altitude_clamps = export_service.export_mission(
        db,
        mission_id,
        body.formats,
        include_geozones=body.include_geozones,
        include_runway_buffers=body.include_runway_buffers,
        dji_heading_mode_override=body.dji_heading_mode_override,
        acknowledge_altitude_clamps=body.acknowledge_altitude_clamps,
    )
    log_audit(
        db,
        current_user,
        AuditAction.EXPORT,
        entity_type="Mission",
        entity_id=mission_id,
        details={
            "formats": body.formats,
            "include_geozones": body.include_geozones,
            "include_runway_buffers": body.include_runway_buffers,
            "dji_heading_mode_override": body.dji_heading_mode_override,
            "acknowledge_altitude_clamps": body.acknowledge_altitude_clamps,
            "altitude_clamps_count": len(altitude_clamps),
        },
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()

    if len(files) == 1:
        filename, (data, content_type) = next(iter(files.items()))
        sanitized = filename.replace('"', "").replace("\r", "").replace("\n", "")
        return Response(
            content=data,
            media_type=content_type,
            headers={"Content-Disposition": f'attachment; filename="{sanitized}"'},
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for filename, (data, _) in files.items():
            zf.writestr(filename, data)

    zip_name = safe_name.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name} export.zip"'},
    )


@router.post("/{mission_id}/dispatch", response_model=WaylineDispatchResponse)
def dispatch_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    body: DispatchRequest | None = None,
    db: Session = Depends(get_db),
):
    """export the KMZ and register it with the field hub's wayline library."""
    mission = check_mission_access(db, current_user, mission_id)
    acknowledge = body.acknowledge_altitude_clamps if body else False
    include_geozones = body.include_geozones if body else False
    include_runway_buffers = body.include_runway_buffers if body else False
    heading_override = body.dji_heading_mode_override if body else None
    dispatch = wayline_dispatch_service.dispatch_mission(
        db,
        mission_id,
        include_geozones=include_geozones,
        include_runway_buffers=include_runway_buffers,
        dji_heading_mode_override=heading_override,
        acknowledge_altitude_clamps=acknowledge,
    )
    log_audit(
        db,
        current_user,
        AuditAction.DISPATCH,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=mission.name,
        details={
            "wayline_id": str(dispatch.wayline_id),
            "include_geozones": include_geozones,
            "include_runway_buffers": include_runway_buffers,
            "dji_heading_mode_override": heading_override,
            "acknowledge_altitude_clamps": acknowledge,
        },
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return dispatch


@router.get("/{mission_id}/mission-report", response_class=Response)
def get_mission_report(
    mission_id: UUID,
    current_user: OperatorUser,
    formats: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    """generate and download mission technical report pdf."""
    # formats is an optional comma-separated list of export formats the operator plans to
    # download (e.g. KMZ,WPML); a wpml-bound format triggers a controller-preset callout
    # in the pdf listing camera settings that wpml 1.0.2 can't carry per waypoint
    check_mission_access(db, current_user, mission_id)
    formats_list = [f.strip().upper() for f in formats.split(",") if f.strip()] if formats else None
    operator_label = current_user.name or current_user.email or "N/A"
    pdf_bytes, filename = mission_report_service.generate_mission_report(
        db, mission_id, formats=formats_list, operator_label=operator_label
    )
    sanitized = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{sanitized}"'},
    )


@router.post("/{mission_id}/complete", response_model=MissionResponse)
def complete_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """EXPORTED -> COMPLETED."""
    check_mission_access(db, current_user, mission_id)
    result = mission_service.transition_mission(db, mission_id, "COMPLETED")
    log_audit(
        db,
        current_user,
        AuditAction.STATUS_CHANGE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=result.name,
        details={"to": "COMPLETED"},
        ip_address=request.client.host if request.client else None,
        airport_id=result.airport_id,
    )
    db.commit()
    return result


@router.post("/{mission_id}/cancel", response_model=MissionResponse)
def cancel_mission(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """EXPORTED -> CANCELLED."""
    check_mission_access(db, current_user, mission_id)
    result = mission_service.transition_mission(db, mission_id, "CANCELLED")
    log_audit(
        db,
        current_user,
        AuditAction.STATUS_CHANGE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=result.name,
        details={"to": "CANCELLED"},
        ip_address=request.client.host if request.client else None,
        airport_id=result.airport_id,
    )
    db.commit()
    return result
