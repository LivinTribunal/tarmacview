"""pydantic schemas for drone profile endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.constants import DJI_WPML_ENUMS, SAFE_IDENTIFIER_RE
from app.schemas.common import ListMeta


def _validate_model_identifier(v: str | None) -> str | None:
    """reject unsafe model identifier values."""
    if v is not None and not SAFE_IDENTIFIER_RE.match(v):
        raise ValueError("model_identifier must only contain alphanumeric, underscore, dash, dot")
    return v


class DroneProfileCreate(BaseModel):
    """drone profile create schema."""

    name: str
    manufacturer: str | None = None
    model: str | None = None
    max_speed: float | None = None
    max_climb_rate: float | None = None
    max_altitude: float | None = None
    battery_capacity: float | None = None
    endurance_minutes: float | None = None
    camera_resolution: str | None = None
    camera_frame_rate: int | None = None
    sensor_fov: float | None = None
    weight: float | None = None
    model_identifier: str | None = None
    max_optical_zoom: float | None = None
    sensor_base_focal_length: float | None = Field(default=None, gt=0)
    default_optical_zoom: float | None = Field(default=None, gt=0)
    supports_geozone_upload: bool = False

    @field_validator("model_identifier")
    @classmethod
    def check_model_identifier(cls, v: str | None) -> str | None:
        """validate model_identifier format."""
        return _validate_model_identifier(v)


class DroneProfileUpdate(BaseModel):
    """drone profile update schema."""

    name: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    max_speed: float | None = None
    max_climb_rate: float | None = None
    max_altitude: float | None = None
    battery_capacity: float | None = None
    endurance_minutes: float | None = None
    camera_resolution: str | None = None
    camera_frame_rate: int | None = None
    sensor_fov: float | None = None
    weight: float | None = None
    model_identifier: str | None = None
    max_optical_zoom: float | None = None
    sensor_base_focal_length: float | None = Field(default=None, gt=0)
    default_optical_zoom: float | None = Field(default=None, gt=0)
    supports_geozone_upload: bool | None = None

    @field_validator("model_identifier")
    @classmethod
    def check_model_identifier(cls, v: str | None) -> str | None:
        """validate model_identifier format."""
        return _validate_model_identifier(v)


class DroneProfileResponse(BaseModel):
    """drone profile response schema."""

    id: UUID
    name: str
    manufacturer: str | None = None
    model: str | None = None
    max_speed: float | None = None
    max_climb_rate: float | None = None
    max_altitude: float | None = None
    battery_capacity: float | None = None
    endurance_minutes: float | None = None
    camera_resolution: str | None = None
    camera_frame_rate: int | None = None
    sensor_fov: float | None = None
    weight: float | None = None
    model_identifier: str | None = None
    max_optical_zoom: float | None = None
    sensor_base_focal_length: float | None = None
    default_optical_zoom: float | None = None
    supports_geozone_upload: bool = False
    created_at: datetime
    updated_at: datetime
    mission_count: int = 0

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def supports_dji_wpml(self) -> bool:
        """true when the drone has an officially mapped dji wpml enum.

        unmapped drones still export to kmz/wpml via the m4t fallback enum;
        this flag lets the frontend show a confirm modal pre-export so the
        operator knows the file is tagged as an m4t.
        """
        return self.model is not None and self.model in DJI_WPML_ENUMS

    @computed_field
    @property
    def is_dji(self) -> bool:
        """true when the drone is manufactured by DJI."""
        return (self.manufacturer or "").strip().upper() == "DJI"


class DroneProfileListResponse(BaseModel):
    """drone profile list response schema."""

    data: list[DroneProfileResponse]
    meta: ListMeta
