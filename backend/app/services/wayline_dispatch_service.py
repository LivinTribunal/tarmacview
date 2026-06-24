"""mission dispatch into the field hub's wayline library."""

import hashlib
import logging
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.constants import DJI_WPML_ENUMS, DJI_WPML_M4T_FALLBACK_ENUM
from app.core.exceptions import DomainError, NotFoundError
from app.models.mission import DroneProfile, Mission
from app.models.wayline_dispatch import WaylineDispatch
from app.services import export as export_service

logger = logging.getLogger(__name__)

REGISTER_PATH = "/internal/api/v1/waylines"

# device dictionary domain segments (dji-cloud-api-reference.md section 6)
_DOMAIN_AIRCRAFT = 0
_DOMAIN_PAYLOAD = 1


def _device_model_keys(drone_profile: DroneProfile | None) -> tuple[str, list[str]]:
    """derive (drone_model_key, payload_model_keys) for pilot's route filter.

    pilot hides waylines whose drone_model_key doesn't match the connected
    aircraft, so the keys must mirror the enums baked into the KMZ. unmapped
    drones fall back to the M4T enum exactly like the exporter does.
    """
    enums = DJI_WPML_M4T_FALLBACK_ENUM
    if drone_profile is not None and drone_profile.model in DJI_WPML_ENUMS:
        enums = DJI_WPML_ENUMS[drone_profile.model]
    drone_enum, drone_sub, payload_enum, payload_sub = enums
    return (
        f"{_DOMAIN_AIRCRAFT}-{drone_enum}-{drone_sub}",
        [f"{_DOMAIN_PAYLOAD}-{payload_enum}-{payload_sub}"],
    )


def _post_kmz_to_hub(
    kmz_bytes: bytes,
    metadata: dict,
    transport: httpx.BaseTransport | None = None,
) -> None:
    """register the wayline with the hub - multipart KMZ + form metadata.

    raises DomainError(502) when the hub is unreachable or refuses, so the
    route never commits a dispatch row for a wayline the hub never stored.
    """
    if not settings.fieldhub_url:
        raise DomainError("field hub is not configured", status_code=502)

    verify = settings.fieldhub_ca if settings.fieldhub_ca else True
    try:
        with httpx.Client(
            base_url=settings.fieldhub_url,
            timeout=settings.fieldhub_timeout,
            verify=verify,
            transport=transport,
        ) as client:
            response = client.post(
                REGISTER_PATH,
                headers={"X-Hub-Secret": settings.fieldhub_shared_secret},
                data=metadata,
                files={
                    "file": (
                        metadata["object_key"].rsplit("/", 1)[-1],
                        kmz_bytes,
                        "application/vnd.google-earth.kmz",
                    )
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("wayline register with field hub failed", exc_info=True)
        raise DomainError("field hub unreachable - wayline not dispatched", status_code=502) from e


def dispatch_mission(
    db: Session,
    mission_id: UUID,
    *,
    acknowledge_altitude_clamps: bool = False,
    transport: httpx.BaseTransport | None = None,
) -> WaylineDispatch:
    """export the mission KMZ, push it to the hub, and upsert the dispatch row.

    reuses export_mission so dispatch inherits the export-eligibility gate
    (VALIDATED/EXPORTED/MEASURED), the VALIDATED -> EXPORTED transition, and
    the 409 altitude-clamp gate.
    re-dispatch updates the existing row in place with a stable wayline uuid.
    flushes; the route logs the DISPATCH audit row and commits.
    """
    files, safe_name, _ = export_service.export_mission(
        db,
        mission_id,
        ["KMZ"],
        acknowledge_altitude_clamps=acknowledge_altitude_clamps,
    )
    kmz_bytes = next(iter(files.values()))[0]

    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    drone_profile = None
    if mission.drone_profile_id is not None:
        drone_profile = (
            db.query(DroneProfile).filter(DroneProfile.id == mission.drone_profile_id).first()
        )

    dispatch = db.query(WaylineDispatch).filter(WaylineDispatch.mission_id == mission_id).first()
    if dispatch is None:
        dispatch = WaylineDispatch(mission_id=mission_id)
        db.add(dispatch)
        db.flush()

    drone_model_key, payload_model_keys = _device_model_keys(drone_profile)
    _post_kmz_to_hub(
        kmz_bytes,
        {
            "wayline_id": str(dispatch.wayline_id),
            "mission_id": str(mission_id),
            "name": safe_name,
            "drone_model_key": drone_model_key,
            "payload_model_keys": ",".join(payload_model_keys),
            "sign": hashlib.md5(kmz_bytes, usedforsecurity=False).hexdigest(),
            "object_key": f"wayline/{dispatch.wayline_id}.kmz",
        },
        transport=transport,
    )

    dispatch.mark_dispatched()
    db.flush()
    db.refresh(dispatch)
    return dispatch
