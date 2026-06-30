"""runway lighting: agl light group and child lha units, with lha-centroid geometry."""

import logging
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.constants import (
    DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG,
    DEFAULT_LHA_TOLERANCE_DEG,
)
from app.core.database import Base
from app.core.exceptions import DomainError

logger = logging.getLogger(__name__)


class AGL(Base):
    """approach guidance light group with child LHA units."""

    __tablename__ = "agl"

    id = Column(UUID, primary_key=True, default=uuid4)
    surface_id = Column(UUID, ForeignKey("airfield_surface.id", ondelete="CASCADE"), nullable=False)
    agl_type = Column(String(30), nullable=False)
    name = Column(String, nullable=False)
    position = Column(String, nullable=False)
    side = Column(String(10))
    glide_slope_angle = Column(Float)
    # results-time verdict band (deg) for the measured glidepath vs this AGL's
    # glide_slope_angle. snapshotted onto the measurement at create time;
    # coordinator-edited alongside glide_slope_angle. NOT a trajectory input.
    glide_slope_angle_tolerance = Column(
        Float, nullable=True, default=DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG
    )
    distance_from_threshold = Column(Float)
    offset_from_centerline = Column(Float)

    surface = relationship("AirfieldSurface", back_populates="agls")
    lhas = relationship("LHA", back_populates="agl", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(
            "agl_type IN ('PAPI', 'RUNWAY_EDGE_LIGHTS')",
            name="ck_agl_agl_type",
        ),
    )

    def calculate_lha_center_point(self) -> tuple[float, float, float]:
        """compute centroid (lon, lat, alt) of all LHA positions."""
        from app.core.geometry import wkt_to_geojson

        if not self.lhas:
            raise ValueError("no LHA units to compute center from")

        lons, lats, alts = [], [], []
        for lha in self.lhas:
            try:
                geojson = wkt_to_geojson(lha.position)
                coords = geojson.get("coordinates") if geojson else None
                if not coords or len(coords) < 3:
                    continue
            except Exception as e:
                logger.warning("failed to parse LHA position for lha %s: %s", lha.id, e)
                continue
            lons.append(coords[0])
            lats.append(coords[1])
            alts.append(coords[2])

        if not lons:
            raise ValueError("no valid LHA positions to compute center from")

        n = len(lons)
        return (sum(lons) / n, sum(lats) / n, sum(alts) / n)


class LHA(Base):
    """light housing assembly - individual light unit within an AGL.

    position.z is normalized to ground elevation at write time (same as obstacles).
    the trajectory engine reads this value directly - no elevation provider override needed.
    """

    __tablename__ = "lha"

    id = Column(UUID, primary_key=True, default=uuid4)
    agl_id = Column(UUID, ForeignKey("agl.id", ondelete="CASCADE"), nullable=False)
    unit_designator = Column(String(4), nullable=False)
    # nullable: PAPI bulk generation leaves this blank for coordinator fill-in per lha
    setting_angle = Column(Float, nullable=True)
    transition_sector_width = Column(Float)
    lamp_type = Column(
        String(10),
        nullable=False,
        default="HALOGEN",
    )
    position = Column(String, nullable=False)
    tolerance = Column(Float, nullable=True, default=DEFAULT_LHA_TOLERANCE_DEG)  # degrees
    # 1..N dense ordinal within the parent AGL, independent of unit_designator
    sequence_number = Column(Integer, nullable=False)
    # PAPI-only lens height; null for non-PAPI units. position.z stays at AGL 0 -
    # these are the surveyed lens optics height for downstream postprocessing
    lens_height_msl_m = Column(Float, nullable=True)  # metres above mean sea level
    lens_height_agl_m = Column(Float, nullable=True)  # metres above ground

    agl = relationship("AGL", back_populates="lhas")

    __table_args__ = (
        CheckConstraint(
            "lamp_type IN ('HALOGEN', 'LED')",
            name="ck_lha_lamp_type",
        ),
        CheckConstraint(
            "length(unit_designator) > 0",
            name="ck_lha_unit_designator",
        ),
        CheckConstraint(
            "sequence_number > 0",
            name="ck_lha_sequence_positive",
        ),
        UniqueConstraint("agl_id", "unit_designator", name="uq_lha_agl_designator"),
        UniqueConstraint("agl_id", "sequence_number", name="uq_lha_agl_sequence"),
    )

    @staticmethod
    def validate_sequence_target(target: int, n_lhas: int) -> None:
        """validate target sequence is within 1..N for the parent AGL."""
        if n_lhas < 1:
            raise DomainError(
                "cannot set sequence_number on an empty AGL",
                status_code=422,
            )
        if target < 1 or target > n_lhas:
            raise DomainError(
                f"sequence_number must be between 1 and {n_lhas}",
                status_code=422,
            )
