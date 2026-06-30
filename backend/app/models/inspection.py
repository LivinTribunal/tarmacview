"""inspection aggregate: inspection, configuration override merging, templates, junction tables."""

from __future__ import annotations

from uuid import UUID as PyUUID
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.enums import (
    ScanLengthAnchor,
    ScanLengthMode,
    ScanRunOrientation,
    ScanWidthSide,
    enum_check_values,
)

# enum values rendered inline into CheckConstraint bodies so the db constraint
# and the python enum cannot drift (mirrors the airport models pattern).
_SCAN_LENGTH_MODE_VALUES = enum_check_values(ScanLengthMode)
_SCAN_LENGTH_ANCHOR_VALUES = enum_check_values(ScanLengthAnchor)
_SCAN_WIDTH_SIDE_VALUES = enum_check_values(ScanWidthSide)
_SCAN_RUN_ORIENTATION_VALUES = enum_check_values(ScanRunOrientation)

# junction tables - no ORM class needed, just a Table for many-to-many with no extra columns
insp_template_targets = Table(
    "insp_template_targets",
    Base.metadata,
    Column(
        "template_id",
        UUID,
        ForeignKey("inspection_template.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "agl_id",
        UUID,
        ForeignKey("agl.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

# config fields consumed by the trajectory pipeline (ResolvedConfig).
# this is the single source of truth imported by trajectory_computation.
# kept at module scope so it can be imported without touching the ORM.
CONFIG_FIELDS: tuple[str, ...] = (
    "altitude_offset",
    "angle_offset_above",
    "angle_offset_below",
    "measurement_speed_override",
    "measurement_density",
    "custom_tolerances",
    "hover_duration",
    "horizontal_distance",
    "sweep_angle",
    "angle_source",
    "angle_start",
    "angle_end",
    "capture_mode",
    "recording_setup_duration",
    "buffer_distance",
    "height_above_lights",
    "lateral_offset",
    "distance_from_lha",
    "height_above_lha",
    "camera_gimbal_angle",
    "selected_lha_id",
    "lha_setting_angle_override_id",
    "hover_bearing",
    "hover_bearing_reference",
    "descent_start_distance",
    "descent_glide_slope_override",
    "scan_surface_id",
    "scan_length_mode",
    "scan_length_anchor",
    "scan_length_from",
    "scan_length_to",
    "scan_width",
    "scan_width_side",
    "scan_height",
    "scan_run_count",
    "scan_run_orientation",
    "scan_sidelap_percent",
    "scan_frontlap_percent",
)


insp_template_methods = Table(
    "insp_template_methods",
    Base.metadata,
    Column(
        "template_id",
        UUID,
        ForeignKey("inspection_template.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("method", String(30), primary_key=True),
)


class InspectionConfiguration(Base):
    """operator overrides for inspection parameters."""

    __tablename__ = "inspection_configuration"

    id = Column(UUID, primary_key=True, default=uuid4)
    altitude_offset = Column(Float)
    # papi-mode offsets - angle_offset_above is added to max(setting_angles) for the
    # arc-side (HORIZONTAL_RANGE) and the climb top bookend (VERTICAL_PROFILE);
    # angle_offset_below is subtracted from min(setting_angles) for the climb start.
    angle_offset_above = Column(Float, nullable=True)
    angle_offset_below = Column(Float, nullable=True)
    measurement_speed_override = Column(Float, nullable=True)
    measurement_density = Column(Integer)
    custom_tolerances = Column(JSONB)
    density = Column(Float)
    hover_duration = Column(Float)  # seconds
    horizontal_distance = Column(Float)
    sweep_angle = Column(Float)
    # vertical-profile climb bookends. PAPI mode resolves angle_start/end from
    # setting angles + offsets at compile time; CUSTOM mode uses these values directly.
    angle_source = Column(String(10), nullable=True, default="CUSTOM")
    angle_start = Column(Float, nullable=True)
    angle_end = Column(Float, nullable=True)
    lha_ids = Column(JSONB)
    # per-AGL selection rule: { agl_id: { mode, params } }. resolved at write time
    # into the flat lha_ids list above; empty {} means "no rule recorded - treat as CUSTOM".
    lha_selection_rules = Column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    capture_mode = Column(String(20), nullable=True)
    recording_setup_duration = Column(Float, nullable=True)
    buffer_distance = Column(Float, nullable=True)
    # method-specific parameters for FLY_OVER / PARALLEL_SIDE_SWEEP / HOVER_POINT_LOCK
    height_above_lights = Column(Float, nullable=True)
    lateral_offset = Column(Float, nullable=True)
    distance_from_lha = Column(Float, nullable=True)
    height_above_lha = Column(Float, nullable=True)
    camera_gimbal_angle = Column(Float, nullable=True)
    selected_lha_id = Column(UUID, ForeignKey("lha.id", ondelete="SET NULL"), nullable=True)
    lha_setting_angle_override_id = Column(
        UUID, ForeignKey("lha.id", ondelete="SET NULL"), nullable=True, index=True
    )
    hover_bearing = Column(Float, nullable=True)
    hover_bearing_reference = Column(String(10), nullable=True)
    # approach-descent (APPROACH_DESCENT). descent_start_distance is how far back
    # of the touchpoint the descent begins; descent_glide_slope_override pins a
    # custom glide slope angle, else the PAPI-derived angle is used.
    descent_start_distance = Column(Float, nullable=True)
    descent_glide_slope_override = Column(Float, nullable=True)
    # surface-scan (SURFACE_SCAN) - AGL-agnostic, targets an AirfieldSurface.
    # scan_surface_id picks the surface; the rest tune the serpentine pass.
    scan_surface_id = Column(
        UUID, ForeignKey("airfield_surface.id", ondelete="SET NULL"), nullable=True
    )
    scan_length_mode = Column(String(20), nullable=True)
    scan_length_anchor = Column(String(20), nullable=True)
    scan_length_from = Column(Float, nullable=True)
    scan_length_to = Column(Float, nullable=True)
    scan_width = Column(Float, nullable=True)
    scan_width_side = Column(String(10), nullable=True)
    scan_height = Column(Float, nullable=True)
    scan_run_count = Column(Integer, nullable=True)
    scan_run_orientation = Column(String(20), nullable=True)
    scan_sidelap_percent = Column(Float, nullable=True)
    # along-track overlap between consecutive photo capture points (percent).
    scan_frontlap_percent = Column(Float, nullable=True)
    # NULL = inherit from mission. NATURAL or REVERSED pin the direction.
    direction = Column(String(10), nullable=True)
    # written by the trajectory compile pre-pass. display only - never accepted on inbound writes.
    resolved_direction = Column(String(10), nullable=True)

    # camera preset reference
    camera_preset_id = Column(
        UUID, ForeignKey("camera_preset.id", ondelete="SET NULL"), nullable=True
    )

    # camera settings - advisory only, not consumed by trajectory. nullable
    # camera_mode (AUTO/MANUAL) = inherit from mission; set to override.
    camera_mode = Column(String(10), nullable=True)
    white_balance = Column(String(20), nullable=True)
    iso = Column(Integer, nullable=True)
    shutter_speed = Column(String(20), nullable=True)
    focus_mode = Column(String(20), nullable=True)
    optical_zoom = Column(Float, nullable=True)

    # surface-scan enum-string columns - CHECK bodies generated from the python
    # enums (null passes, so the nullable columns are unconstrained when unset).
    __table_args__ = (
        CheckConstraint(
            f"scan_length_mode IN ({_SCAN_LENGTH_MODE_VALUES})",
            name="ck_inspection_configuration_scan_length_mode",
        ),
        CheckConstraint(
            f"scan_length_anchor IN ({_SCAN_LENGTH_ANCHOR_VALUES})",
            name="ck_inspection_configuration_scan_length_anchor",
        ),
        CheckConstraint(
            f"scan_width_side IN ({_SCAN_WIDTH_SIDE_VALUES})",
            name="ck_inspection_configuration_scan_width_side",
        ),
        CheckConstraint(
            f"scan_run_orientation IN ({_SCAN_RUN_ORIENTATION_VALUES})",
            name="ck_inspection_configuration_scan_run_orientation",
        ),
    )

    # fields merged by resolve_with_defaults. a superset of CONFIG_FIELDS that
    # additionally includes lha_ids so duplicate_mission copies it; lha_ids is
    # NOT consumed from ResolvedConfig in the trajectory path - the orchestrator
    # reads inspection.lha_ids directly. direction is read directly by the
    # trajectory pre-pass; resolved_direction is written there too.
    _MERGE_FIELDS = CONFIG_FIELDS + (
        "lha_ids",
        "lha_selection_rules",
        "white_balance",
        "iso",
        "shutter_speed",
        "focus_mode",
        "optical_zoom",
        "direction",
        "resolved_direction",
    )

    def resolve_with_defaults(self, template_config: InspectionConfiguration | None):
        """merge this config over template defaults, returning field dict."""
        merged = {}
        for key in self._MERGE_FIELDS:
            template_val = getattr(template_config, key, None) if template_config else None
            override_val = getattr(self, key, None)

            merged[key] = override_val if override_val is not None else template_val

        return merged


class InspectionTemplate(Base):
    """reusable inspection template with default config and targets."""

    __tablename__ = "inspection_template"

    id = Column(UUID, primary_key=True, default=uuid4)
    name = Column(String, nullable=False)
    description = Column(String)
    default_config_id = Column(
        UUID,
        ForeignKey("inspection_configuration.id", ondelete="SET NULL"),
    )
    angular_tolerances = Column(JSONB)
    created_by = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    default_config = relationship("InspectionConfiguration")
    targets = relationship("AGL", secondary=insp_template_targets)

    def validate_method_agl_compat(self, methods: list[str] | None = None) -> None:
        """enforce method/AGL-type compatibility matrix.

        raises ValueError on incompatible combos.
        if methods is None, reads self.methods (set by service/_enrich).
        """
        from app.core.enums import METHOD_AGL_COMPAT, InspectionMethod

        effective = methods if methods is not None else getattr(self, "methods", [])
        if not effective or not self.targets:
            return

        target_types = {agl.agl_type for agl in self.targets}
        for raw in effective:
            try:
                m = InspectionMethod(raw)
            except ValueError as e:
                raise ValueError(f"unknown inspection method: {raw}") from e

            allowed = METHOD_AGL_COMPAT.get(m, set())
            bad = target_types - allowed
            if bad:
                bad_str = ", ".join(sorted(bad))
                raise ValueError(f"method {m.value} is not compatible with AGL type(s): {bad_str}")


class Inspection(Base):
    """single inspection pass within a mission."""

    __tablename__ = "inspection"

    id = Column(UUID, primary_key=True, default=uuid4)
    mission_id = Column(UUID, ForeignKey("mission.id", ondelete="CASCADE"), nullable=False)
    template_id = Column(UUID, ForeignKey("inspection_template.id"), nullable=False)
    config_id = Column(UUID, ForeignKey("inspection_configuration.id"))
    method = Column(String(30), nullable=False)  # validated at schema level
    sequence_order = Column(Integer, nullable=False)

    mission = relationship("Mission", back_populates="inspections")
    template = relationship("InspectionTemplate")
    config = relationship("InspectionConfiguration")

    @property
    def lha_ids(self) -> list[PyUUID] | None:
        """lha ids from associated config, or none."""
        if self.config and self.config.lha_ids:
            return [PyUUID(s) if isinstance(s, str) else s for s in self.config.lha_ids]
        if self.config and self.config.selected_lha_id:
            sid = self.config.selected_lha_id
            return [PyUUID(sid) if isinstance(sid, str) else sid]
        return None

    def is_speed_compatible_with_frame_rate(
        self, drone_profile, speed: float, path_distance: float = 0.0
    ) -> bool:
        """check if speed is compatible with camera frame rate at measurement density.

        at speed v and frame_rate f, capture spacing is v/f meters.
        speed is compatible when v/f <= waypoint_spacing (= path_distance / (density - 1)).
        """
        if not drone_profile or not drone_profile.camera_frame_rate:
            return True
        if not self.config or not self.config.measurement_density:
            return True

        density = self.config.measurement_density
        if density < 2:
            return True

        if drone_profile.max_speed and speed > drone_profile.max_speed:
            return False

        if path_distance > 0:
            waypoint_spacing = path_distance / (density - 1)
            max_compatible_speed = waypoint_spacing * drone_profile.camera_frame_rate
            if speed > max_compatible_speed:
                return False

        return True
