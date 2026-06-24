"""drone media DTOs - mission-grouped listing, per-inspection upload, ingest confirm."""

from uuid import UUID

from pydantic import BaseModel

from app.schemas.field_link import DroneMediaFileResponse


class MissionMediaGroup(BaseModel):
    """one mission's media files in the upload dialog."""

    mission_id: UUID
    mission_name: str
    files: list[DroneMediaFileResponse]


class DroneMediaListResponse(BaseModel):
    """mission groups plus the unassigned bucket."""

    missions: list[MissionMediaGroup]
    unassigned: list[DroneMediaFileResponse]


class MediaAssignRequest(BaseModel):
    """manual reassignment target - null moves the file to the unassigned bucket."""

    mission_id: UUID | None = None


class UploadUrlRequest(BaseModel):
    """request a presigned PUT target for one manual media upload."""

    filename: str
    content_type: str | None = None


class UploadUrlResponse(BaseModel):
    """presigned PUT target the browser uploads to directly - no row yet."""

    object_key: str
    upload_url: str


class MediaViewUrlResponse(BaseModel):
    """presigned GET target the browser opens to stream or download one media file."""

    url: str


class CompleteUploadRequest(BaseModel):
    """record a finished manual upload against a mission and optional inspection."""

    mission_id: UUID
    inspection_id: UUID | None = None
    object_key: str
    filename: str
    size_bytes: int


class MediaMoveRequest(BaseModel):
    """reassign a media file to an inspection and optional position; null detaches it."""

    inspection_id: UUID | None = None
    order_index: int | None = None


class MediaReorderRequest(BaseModel):
    """new dense order of an inspection's media, by media id."""

    ordered_ids: list[UUID]


class InspectionMediaGroup(BaseModel):
    """one inspection's ordered media in the per-inspection upload form."""

    inspection_id: UUID
    method: str
    sequence_order: int
    files: list[DroneMediaFileResponse]


class MissionInspectionMediaResponse(BaseModel):
    """mission media grouped by inspection plus the mission-level unassigned bucket."""

    mission_id: UUID
    mission_name: str
    inspections: list[InspectionMediaGroup]
    unassigned: list[DroneMediaFileResponse]


class ConfirmIngestRequest(BaseModel):
    """mission whose media is confirmed into the processing pipeline."""

    mission_id: UUID


class ConfirmIngestResponse(BaseModel):
    """ingest confirmation outcome - count is 0 on an idempotent repeat."""

    mission_id: UUID
    ingested_count: int
