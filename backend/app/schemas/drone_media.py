"""drone media DTOs - mission-grouped listing, manual assignment, ingest confirm."""

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


class ConfirmIngestRequest(BaseModel):
    """mission whose media is confirmed into the processing pipeline."""

    mission_id: UUID


class ConfirmIngestResponse(BaseModel):
    """ingest confirmation outcome - count is 0 on an idempotent repeat."""

    mission_id: UUID
    ingested_count: int
