"""mission aggregate root: status state machine, inspections, drone profile, constraint rules."""

from datetime import datetime, timezone
from uuid import UUID as PyUUID
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.constants import MIN_TRANSIT_ALTITUDE_AGL_M
from app.core.database import Base
from app.core.enums import ComputationStatus, MissionStatus

MAX_INSPECTIONS = 10

# status state machine - valid transitions.
# MEASURED sits between EXPORTED and the terminal states; a mission measured
# straight from VALIDATED skips EXPORTED. a mission can only be completed or
# cancelled once it has been measured - the terminal states are reachable only
# from MEASURED.
TRANSITIONS = {
    "DRAFT": ["PLANNED"],
    "PLANNED": ["VALIDATED"],
    "VALIDATED": ["EXPORTED", "MEASURED"],
    "EXPORTED": ["MEASURED"],
    "MEASURED": ["COMPLETED", "CANCELLED"],
    "COMPLETED": [],
    "CANCELLED": [],
}

# fields that affect trajectory - changing these invalidates computed trajectory.
# dji_heading_mode is intentionally absent: it only flips an export-time WPML
# serialization branch and never touches waypoint (lon, lat, alt) or heading.
TRAJECTORY_FIELDS = {
    "drone_profile_id",
    "default_speed",
    "measurement_speed_override",
    "default_altitude_offset",
    "takeoff_coordinate",
    "landing_coordinate",
    "default_capture_mode",
    "default_buffer_distance",
    "transit_agl",
    "require_perpendicular_runway_crossing",
    "keep_inside_airport_boundary",
    "flight_plan_scope",
    "direction",
}

# dji wpml waypointHeadingMode values supported per-mission. mirrors the
# CHECK constraint emitted by 0002_dji_heading_mode so the DB constraint
# and the python literal cannot drift. smoothTransition is the default -
# body yaw is interpolated between per-WP angles, no runtime POI math.
# towardPOI is experimental (continuous POI tracking, hardware-dependent).
# followWayline is the proven fallback that snaps body heading at each WP.
_DJI_HEADING_MODE_VALUES = ("smoothTransition", "towardPOI", "followWayline")


class DroneProfile(Base):
    """drone hardware profile with performance limits."""

    __tablename__ = "drone_profile"

    id = Column(UUID, primary_key=True, default=uuid4)
    name = Column(String, nullable=False)
    manufacturer = Column(String)
    model = Column(String)
    max_speed = Column(Float)
    max_climb_rate = Column(Float)
    max_altitude = Column(Float)
    battery_capacity = Column(Float)
    endurance_minutes = Column(Float)
    camera_resolution = Column(String)
    camera_frame_rate = Column(Integer)
    sensor_fov = Column(Float)
    weight = Column(Float)
    model_identifier = Column(String, nullable=True)
    max_optical_zoom = Column(Float, nullable=True)
    # 1x focal length (mm) - used to translate optical_zoom into dji wpml focalLength.
    sensor_base_focal_length = Column(Float, nullable=True)
    # neutral framing zoom factor - emission skipped when an inspection matches this value.
    default_optical_zoom = Column(Float, nullable=True, server_default="1.0")
    # capability bit - true when the airframe accepts geofence polygons in its mission file.
    supports_geozone_upload = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Mission(Base):
    """aggregate root - owns inspections and controls status transitions."""

    __tablename__ = "mission"

    id = Column(UUID, primary_key=True, default=uuid4)
    name = Column(String, nullable=False)
    status = Column(
        String(20),
        nullable=False,
        default="DRAFT",
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    airport_id = Column(UUID, ForeignKey("airport.id", ondelete="CASCADE"), nullable=False)
    operator_notes = Column(String)
    drone_profile_id = Column(UUID, ForeignKey("drone_profile.id", ondelete="SET NULL"))
    date_time = Column(DateTime(timezone=True))
    default_speed = Column(Float)
    measurement_speed_override = Column(Float, nullable=True)
    default_altitude_offset = Column(Float)
    takeoff_coordinate = Column(String)
    landing_coordinate = Column(String)
    default_capture_mode = Column(String(20), nullable=True, default="VIDEO_CAPTURE")
    default_buffer_distance = Column(Float, nullable=True)

    # operator's last-used per-export wpml heading mode (values explained at
    # _DJI_HEADING_MODE_VALUES). the export endpoint accepts a per-export
    # override and writes it back here on success. NOT in TRAJECTORY_FIELDS -
    # flipping the export shape must not regress mission status to DRAFT.
    dji_heading_mode = Column(
        String(20), nullable=True, default="smoothTransition", server_default="smoothTransition"
    )

    # mission-level camera defaults - inspection overrides take precedence
    camera_mode = Column(String(10), nullable=False, default="AUTO", server_default="AUTO")
    default_white_balance = Column(String(20), nullable=True)
    default_iso = Column(Integer, nullable=True)
    default_shutter_speed = Column(String(20), nullable=True)
    default_focus_mode = Column(String(20), nullable=True)

    transit_agl = Column(Float, nullable=True)
    require_perpendicular_runway_crossing = Column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    keep_inside_airport_boundary = Column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    flight_plan_scope = Column(
        String(25),
        nullable=False,
        default="FULL",
        server_default="FULL",
    )
    # mission-wide direction: AUTO = solver picks, NATURAL/REVERSED override per inspection inherit
    direction = Column(String(10), nullable=False, default="AUTO", server_default="AUTO")
    has_unsaved_map_changes = Column(Boolean, nullable=False, default=False, server_default="false")

    # trajectory computation lifecycle
    computation_status = Column(String(20), nullable=False, default="IDLE", server_default="IDLE")
    computation_error = Column(String, nullable=True)
    computation_started_at = Column(DateTime(timezone=True), nullable=True)

    airport = relationship("Airport")
    drone_profile = relationship("DroneProfile")
    inspections = relationship("Inspection", back_populates="mission", cascade="all, delete-orphan")
    # passive_deletes lets the DB-level CASCADE on flight_plan.mission_id handle cleanup
    flight_plan = relationship(
        "FlightPlan", back_populates="mission", uselist=False, passive_deletes=True
    )
    # constraints survive flight-plan regeneration - operator-attached lifecycle
    constraints = relationship(
        "ConstraintRule", back_populates="mission", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'PLANNED', 'VALIDATED', 'EXPORTED', 'MEASURED', "
            "'COMPLETED', 'CANCELLED')",
            name="ck_mission_status",
        ),
        CheckConstraint(
            "flight_plan_scope IN ('FULL', 'MEASUREMENTS_ONLY')",
            name="ck_mission_flight_plan_scope",
        ),
        CheckConstraint(
            "direction IN ('AUTO', 'NATURAL', 'REVERSED')",
            name="ck_mission_direction",
        ),
        CheckConstraint(
            "computation_status IN ('IDLE', 'COMPUTING', 'COMPLETED', 'FAILED')",
            name="ck_mission_computation_status",
        ),
        CheckConstraint(
            "dji_heading_mode IN ('" + "', '".join(_DJI_HEADING_MODE_VALUES) + "')",
            name="ck_mission_dji_heading_mode",
        ),
    )

    def transition_to(self, target_status: str):
        """enforce status state machine transitions."""
        allowed = TRANSITIONS.get(self.status, [])
        if target_status not in allowed:
            raise ValueError(
                f"cannot transition from {self.status} to {target_status}, allowed: {allowed}"
            )
        self.status = target_status

    def mark_measured(self):
        """transition VALIDATED/EXPORTED -> MEASURED on measurement kickoff, idempotent.

        a mission with multiple inspections hits create_measurement more than once,
        so this fires on the first call and no-ops once already MEASURED (or in any
        other status) rather than raising.
        """
        if self.status in self.POST_PLAN_STATUSES:
            self.transition_to(MissionStatus.MEASURED)

    # mission is finished - immutable history, callers must duplicate to edit
    TERMINAL_STATUSES = frozenset({MissionStatus.COMPLETED, MissionStatus.CANCELLED})

    # mission has a persisted flight plan but is not yet exported
    NON_DRAFT_WITH_PLAN_STATUSES = frozenset(
        {MissionStatus.PLANNED, MissionStatus.VALIDATED, MissionStatus.EXPORTED}
    )

    # mission has been validated or already exported - export gate
    POST_PLAN_STATUSES = frozenset({MissionStatus.VALIDATED, MissionStatus.EXPORTED})

    # waypoint edits still allowed (regress to PLANNED), exports/completion are not
    PRE_EXPORT_EDITABLE_STATUSES = frozenset(
        {MissionStatus.DRAFT, MissionStatus.PLANNED, MissionStatus.VALIDATED}
    )

    # mission has not yet been validated - safe for trajectory generation / drone swaps
    PRE_PLAN_STATUSES = frozenset({MissionStatus.DRAFT, MissionStatus.PLANNED})

    def assert_deletable(self) -> None:
        """raise ValueError if the mission is in a terminal status.

        terminal missions are kept as immutable history; callers should
        duplicate them rather than deleting.
        """
        if self.status in self.TERMINAL_STATUSES:
            raise ValueError("cannot delete mission in completed or cancelled state")

    def has_trajectory_changes(self, data: dict) -> bool:
        """return True when `data` touches any trajectory-affecting field."""
        return any(k in TRAJECTORY_FIELDS for k in data.keys())

    def regress_if_trajectory_changed(self, data: dict) -> bool:
        """regress to DRAFT and mark unsaved when `data` touches a trajectory field.

        returns True when regression happened. does NOT apply field values -
        callers still own field assignment via apply_schema_update / setattr.
        the existing flight plan row is intentionally kept so the frontend
        can render it as a stale reference until a fresh recompute. raises
        ValueError when the mission is in a terminal status.
        """
        if not self.has_trajectory_changes(data):
            return False
        self.invalidate_trajectory()
        return True

    def modify_inspections(self, fn):
        """run a mutator callback over inspections and invalidate the trajectory.

        the existing flight plan row is intentionally kept so the frontend
        can render it as a stale reference until a fresh recompute. raises
        ValueError when the mission is in a terminal state.
        """
        result = fn()
        self.invalidate_trajectory()
        return result

    def duplicate(self) -> "Mission":
        """clone this mission as a new DRAFT with copied inspections and configs.

        the returned Mission and its child entities are unattached - callers
        must add the copy to a session and flush.
        """
        from app.models.inspection import Inspection, InspectionConfiguration

        copy = Mission(
            name=f"{self.name} (copy)",
            status=MissionStatus.DRAFT,
            airport_id=self.airport_id,
            drone_profile_id=self.drone_profile_id,
            operator_notes=self.operator_notes,
            default_speed=self.default_speed,
            measurement_speed_override=self.measurement_speed_override,
            default_altitude_offset=self.default_altitude_offset,
            takeoff_coordinate=self.takeoff_coordinate,
            landing_coordinate=self.landing_coordinate,
            default_capture_mode=self.default_capture_mode,
            default_buffer_distance=self.default_buffer_distance,
            dji_heading_mode=self.dji_heading_mode,
            transit_agl=self.transit_agl,
            keep_inside_airport_boundary=self.keep_inside_airport_boundary,
            flight_plan_scope=self.flight_plan_scope,
            direction=self.direction,
        )
        for insp in self.inspections:
            new_config = None
            if insp.config:
                config_fields = {
                    f: getattr(insp.config, f) for f in InspectionConfiguration._MERGE_FIELDS
                }
                new_config = InspectionConfiguration(**config_fields)
            copy.inspections.append(
                Inspection(
                    template_id=insp.template_id,
                    config=new_config,
                    method=insp.method,
                    sequence_order=insp.sequence_order,
                )
            )
        return copy

    def regress_to_planned(self):
        """regress VALIDATED/EXPORTED -> PLANNED when waypoints are modified in place.

        bypasses transition_to() because the state machine has no backward
        transitions by design - this is the intentional exception for waypoint
        edits that don't invalidate the full trajectory but do invalidate validation.
        """
        if self.status in self.TERMINAL_STATUSES:
            raise ValueError("cannot modify mission in completed or cancelled state")
        if self.status in self.POST_PLAN_STATUSES:
            self.status = MissionStatus.PLANNED

    def invalidate_trajectory(self):
        """regress PLANNED/VALIDATED/EXPORTED -> DRAFT when trajectory-affecting data changes.

        bypasses transition_to() because the state machine has no backward
        transitions by design - this is the intentional exception for config changes
        that invalidate the computed trajectory.

        the existing flight plan row is intentionally kept so the frontend can
        render it as a stale reference until the operator triggers a fresh
        recompute; sets has_unsaved_map_changes so callers know a recompute
        is pending.

        MEASURED is locked: the footage was already scored against the planned
        LHA ground truth, so editing the plan afterwards would orphan the
        measurement. its only forward transitions are COMPLETED / CANCELLED.
        """
        if self.status in self.TERMINAL_STATUSES:
            raise ValueError("cannot modify mission in completed or cancelled state")
        if self.status == MissionStatus.MEASURED:
            raise ValueError("cannot modify mission after measurement")
        if self.status in self.NON_DRAFT_WITH_PLAN_STATUSES:
            self.status = MissionStatus.DRAFT
        self.has_unsaved_map_changes = True
        self.reset_computation_status()

    def add_inspection(self, inspection):
        """add inspection - invalidates trajectory, blocked after export."""
        self.invalidate_trajectory()
        if len(self.inspections) >= MAX_INSPECTIONS:
            raise ValueError(f"mission already has {MAX_INSPECTIONS} inspections (max limit)")

        inspection.mission_id = self.id
        self.inspections.append(inspection)

    def remove_inspection(self, inspection_id):
        """remove inspection by id - invalidates trajectory, blocked after export."""
        self.invalidate_trajectory()

        target = PyUUID(str(inspection_id))
        for insp in self.inspections:
            if insp.id == target:
                self.inspections.remove(insp)
                return insp

        raise ValueError(f"inspection {inspection_id} not found")

    def change_drone_profile(self, drone_profile_id):
        """change drone profile - invalidates trajectory, blocked after export.

        note: mission_service.update_mission currently handles drone profile
        changes via TRAJECTORY_FIELDS check + invalidate_trajectory() directly,
        bypassing this method. kept as the canonical aggregate-root api for
        programmatic callers and test coverage.
        """
        self.invalidate_trajectory()
        self.drone_profile_id = drone_profile_id

    def mark_computing(self):
        """set computation status to COMPUTING with timestamp."""
        self.computation_status = ComputationStatus.COMPUTING
        self.computation_error = None
        self.computation_started_at = datetime.now(timezone.utc)

    def mark_computation_completed(self):
        """set computation status to COMPLETED after successful generation."""
        self.computation_status = ComputationStatus.COMPLETED
        self.computation_error = None
        self.computation_started_at = None

    def mark_computation_failed(self, error: str):
        """set computation status to FAILED with error message."""
        self.computation_status = ComputationStatus.FAILED
        self.computation_error = error
        self.computation_started_at = None

    def resolve_staleness(self, timeout_minutes: int = 5) -> bool:
        """check if a COMPUTING state is stale and mark as failed if so.

        returns true if status was stale and changed to FAILED.
        """
        if self.computation_status != ComputationStatus.COMPUTING:
            return False
        if self.computation_started_at is None:
            return False

        started = self.computation_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        if elapsed > timeout_minutes * 60:
            self.mark_computation_failed("computation timed out")
            return True
        return False

    def reset_computation_status(self):
        """reset computation status to IDLE."""
        self.computation_status = ComputationStatus.IDLE
        self.computation_error = None
        self.computation_started_at = None

    @property
    def supports_geozone_upload(self) -> bool | None:
        """proxy DroneProfile.supports_geozone_upload through the relationship.

        returns None when no drone profile is attached so the export panel can
        distinguish 'no drone selected' from 'drone selected but incapable'.
        """
        if self.drone_profile is None:
            return None
        return bool(self.drone_profile.supports_geozone_upload)

    def validate_transit_altitude(self, drone: "DroneProfile | None" = None):
        """enforce transit altitude business rules.

        rules: positive, >= MIN_TRANSIT_ALTITUDE_AGL_M, <= drone max altitude
        when a drone profile is attached. raises ValueError on failure; no-op
        when the field is not set.
        """
        value = self.transit_agl
        if value is None:
            return

        if value <= 0:
            raise ValueError("transit_agl must be greater than 0")
        if value < MIN_TRANSIT_ALTITUDE_AGL_M:
            raise ValueError(f"transit_agl must be at least {MIN_TRANSIT_ALTITUDE_AGL_M:.0f}m AGL")
        if drone and drone.max_altitude is not None and value > drone.max_altitude:
            raise ValueError(
                f"transit_agl {value:.0f}m exceeds drone max altitude {drone.max_altitude:.0f}m"
            )
