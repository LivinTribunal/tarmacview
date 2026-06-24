"""media module dtos mirroring the demo's fast-upload and callback payloads."""

import math

from pydantic import AliasChoices, BaseModel, Field, field_validator


def _strip_control_chars(value: str) -> str:
    """drop nul and other control bytes a device may append to a string field."""
    return "".join(ch for ch in value if ord(ch) >= 0x20 and ord(ch) != 0x7F).strip()


class MediaFastUploadRequest(BaseModel):
    """fingerprint pre-check body - do you already have this file?"""

    fingerprint: str
    name: str | None = None
    path: str | None = None


class TinyFingerprintsRequest(BaseModel):
    """batch pre-check body."""

    tiny_fingerprints: list[str] = []


class TinyFingerprintsData(BaseModel):
    """batch pre-check answer - the subset the hub already has."""

    tiny_fingerprints: list[str]


class ShootPosition(BaseModel):
    """capture coordinates as pilot reports them."""

    lat: float
    lng: float


class MediaFileMetadata(BaseModel):
    """demo MediaFileMetadata - the matching input for tarmacview."""

    absolute_altitude: float | None = None
    relative_altitude: float | None = None
    gimbal_yaw_degree: float | None = None
    created_time: str | None = None
    shoot_position: ShootPosition | None = None

    @field_validator("created_time", mode="before")
    @classmethod
    def _clean_created_time(cls, value):
        """device sometimes appends a nul byte to the timestamp - strip it before parse."""
        if not isinstance(value, str):
            return value
        return _strip_control_chars(value) or None

    @field_validator("shoot_position", mode="after")
    @classmethod
    def _drop_unusable_position(cls, value):
        """null a position the device couldn't fix - non-finite or out-of-range coords."""
        if value is None:
            return None
        if not (math.isfinite(value.lat) and math.isfinite(value.lng)):
            return None
        if not (-90.0 <= value.lat <= 90.0 and -180.0 <= value.lng <= 180.0):
            return None
        return value


class MediaFileExtension(BaseModel):
    """demo MediaFileExtension - drone sn / payload / flight linkage."""

    sn: str | None = None
    drone_model_key: str | None = None
    payload_model_key: str | None = None
    is_original: bool | None = None
    file_group_id: str | None = None
    flight_id: str | None = None
    # demo wire name is the misspelled "tinny_fingerprint" - accept both
    tiny_fingerprint: str | None = Field(
        default=None,
        validation_alias=AliasChoices("tinny_fingerprint", "tiny_fingerprint"),
    )


class MediaUploadCallbackRequest(BaseModel):
    """demo MediaUploadCallbackRequest - pilot reports a completed upload."""

    fingerprint: str
    object_key: str
    name: str | None = None
    path: str | None = None
    sub_file_type: int | None = None
    metadata: MediaFileMetadata | None = None
    ext: MediaFileExtension | None = None
