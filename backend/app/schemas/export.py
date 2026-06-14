"""export request/response schemas."""

from typing import Literal

from pydantic import BaseModel, field_validator, model_validator

from app.schemas.mission import DjiHeadingModeStr

_VALID_FORMATS = {
    "KML",
    "KMZ",
    "JSON",
    "MAVLINK",
    "UGCS",
    "WPML",
    "CSV",
    "GPX",
    "LITCHI",
    "DRONEDEPLOY",
}

# formats that can carry keep-out polygons (native or advisory).
# native enforcement: MAVLINK / JSON / UGCS. KML / KMZ are advisory - DJI Pilot 2
# renders the polygons but does not enforce them at flight time.
GEOZONE_CAPABLE_FORMATS = {"MAVLINK", "JSON", "UGCS", "KMZ", "KML"}


class ExportRequest(BaseModel):
    """request body for export endpoint."""

    formats: list[str]
    include_geozones: bool = False
    include_runway_buffers: bool = False
    # per-export override of mission.dji_heading_mode. only consumed by the
    # KMZ / WPML generators. when supplied and different from the persisted
    # column, the export endpoint writes it back so the next export pre-fills.
    dji_heading_mode_override: DjiHeadingModeStr | None = None
    # operator opt-in to ship a KMZ/WPML file whose DJI placemark altitudes
    # are clamped to the takeoff reference. false (default) makes the endpoint
    # refuse with 409 + the clamp list so the operator sees the modification
    # before any file leaves the server.
    acknowledge_altitude_clamps: bool = False

    @field_validator("formats")
    @classmethod
    def validate_formats(cls, v: list[str]) -> list[str]:
        """ensure at least one valid format is provided."""
        if not v:
            raise ValueError("at least one format is required")

        for fmt in v:
            if fmt not in _VALID_FORMATS:
                raise ValueError(f"invalid format '{fmt}', must be one of {_VALID_FORMATS}")

        return list(dict.fromkeys(v))

    @model_validator(mode="after")
    def _check_runway_buffers_requires_parent(self) -> "ExportRequest":
        """include_runway_buffers is only meaningful when include_geozones is on."""
        if self.include_runway_buffers and not self.include_geozones:
            raise ValueError("include_runway_buffers requires include_geozones=true")
        return self


class AltitudeClamp(BaseModel):
    """one DJI placemark altitude that was clamped to the takeoff reference."""

    waypoint_index: int
    intended_alt: float
    clamped_alt: float
    reason: Literal["below_takeoff"]


class ExportResponse(BaseModel):
    """JSON body returned on a 409 when DJI altitude clamps need acknowledgment."""

    altitude_clamps: list[AltitudeClamp]
