"""shared numeric constants used across models, schemas, and services."""

import re

# minimum allowable cruise altitude (m AGL) - enforced by validators in
# both the persistence layer (mission model) and the request schema, and
# used by the trajectory safety validator as the terrain-following floor.
MIN_TRANSIT_ALTITUDE_AGL_M: float = 5.0

# default buffer distance (meters) added around surfaces and obstacles
# when no explicit value is supplied. mirrors the column server default
# on AirfieldSurface and Obstacle, and is also the seed value for
# settings.vertex_buffer_m so they cannot drift apart at runtime.
DEFAULT_BUFFER_DISTANCE_M: float = 5.0

# unit conversion factors - shared by openaip ingest and any future
# spec input that arrives in feet, nautical miles, or kilometers.
METERS_PER_FOOT: float = 0.3048
METERS_PER_NM: float = 1852.0
METERS_PER_KM: float = 1000.0

# default search radius (km) used when querying openaip for nearby
# airspaces and obstacles around an airport.
OPENAIP_NEARBY_RADIUS_KM: float = 25.0

# WGS84 mean earth radius (m) - shared by haversine distance, equirectangular
# projection, and the openaip ingest path.
EARTH_RADIUS_M: float = 6_371_000.0

# meters per degree of latitude (WGS84 mean) - shared by the litchi/dji local
# equirectangular projection, the media-match bbox padding, and lha_selection.
METERS_PER_DEG_LAT: float = 111_320.0

# vertical-profile climb angle envelope - clamps both PAPI-resolved bookends
# and CUSTOM-mode operator input. enforced at the request schema (Field
# bounds on angle_start / angle_end) and at the trajectory engine
# (resolve_vertical_profile_angles clamps).
MIN_VERTICAL_PROFILE_ANGLE_DEG: float = 1.0
MAX_VERTICAL_PROFILE_ANGLE_DEG: float = 16.5

# default glide slope (deg) - PAPI fallback when an AGL has no glide_slope_angle
# set, and the placeholder value passed to the helpers from the heading-optimizer
# (where lon/lat scoring is independent of altitude).
DEFAULT_GLIDE_SLOPE_DEG: float = 3.0

# default glidepath tolerance (deg) - results-time verdict band for the measured
# glidepath vs the configured AGL glide slope. mirrors the frontend
# DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE; applied at the orm column default on
# AGL.glide_slope_angle_tolerance and at the measurement snapshot when the AGL
# leaves it unset. coordinator-edited like the AGL glide slope. NOT a trajectory input.
DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG: float = 0.1

# default LHA setting-angle tolerance (deg) - applied at the orm column default
# on LHA.tolerance, at the bulk-generate request schema default, and at the
# bulk-generate service fallback when the inbound payload omits it. shared so
# the three layers cannot drift.
DEFAULT_LHA_TOLERANCE_DEG: float = 0.1

# buffer (m) grown around a mission's flight-plan bounding box when testing
# whether a media capture position belongs to that mission. wide enough to
# absorb consumer-grade gps error and small pilot deviations, tight enough to
# keep missions on different parts of the airfield apart.
MEDIA_MATCH_AREA_BUFFER_M: float = 100.0

# safe filesystem identifier - alphanumeric plus underscore, dash, optional
# single-extension suffix. shared by the drone-profile request schema and the
# service-layer re-validation before any filesystem operation.
SAFE_IDENTIFIER_RE: re.Pattern = re.compile(r"^[a-zA-Z0-9_\-]+(\.[a-zA-Z0-9]+)?$")

# float-comparison epsilons - named so call sites read intent, not magic
# numbers. these are three semantically distinct things; do not collapse
# them into a single value.

# tie-breaker margin for scalar cost comparisons in the heading-optimizer
# brute-force search. an alternative beats the incumbent only when its cost
# is lower by at least this much - guards against ULP-level float noise from
# different summation orders flipping the chosen direction plan, and keeps
# the solver deterministic + conservative (status quo wins ties).
COST_COMPARISON_EPSILON: float = 1e-9

# threshold (m) below which a horizontal offset is treated as zero. used by
# fly-over to skip the back-shift along the reverse heading when the
# camera-gimbal geometry collapses to ~vertical (e.g. -90 deg gimbal hits
# this branch). picking an epsilon means we never call point_at_distance
# with a sub-nanometer step.
NEGLIGIBLE_OFFSET_M: float = 1e-9

# threshold for treating a 2x2 determinant (cross product of two 2D vectors)
# as zero. used by pathfinding when projecting points onto runway centerlines
# to detect parallel/degenerate segments before dividing. tighter than the
# offset epsilon because the determinant is a product of two coordinate
# differences, so ULP noise compounds.
DETERMINANT_DEGENERACY_EPSILON: float = 1e-15

# dji wpml drone + payload enum table, keyed by drone_profile.model. tuple
# is (droneEnumValue, droneSubEnumValue, payloadEnumValue,
# payloadSubEnumValue). lives in core so both the schema (computed
# `supports_dji_wpml` flag on DroneProfileResponse) and the dji export
# service can read it without crossing the schema -> service layer.
#
# the m4t pair (99/1/89/0) is empirical - lifted from a real m4t fh2 export
# and litchi-confirmed; the rest come from dji's cloud-api-doc
# common-element.md. m300/m350 are modular-payload aircraft, so the h20t
# payload (43) is the default. drones absent from this table fall back to
# the m4t pair so the kmz still renders in fh2 / pilot 2 - aircraft
# firmware drives flight, the enum just labels the file. the frontend
# shows a warning modal pre-export when the configured drone is unmapped.
DJI_WPML_ENUMS: dict[str, tuple[str, str, str, str]] = {
    "Matrice 4T": ("99", "1", "89", "0"),
    "Matrice 300 RTK": ("60", "0", "43", "0"),
    "Matrice 350 RTK": ("89", "0", "43", "0"),
    "Mavic 3 Enterprise": ("77", "0", "66", "0"),
}
DJI_WPML_M4T_FALLBACK_ENUM: tuple[str, str, str, str] = DJI_WPML_ENUMS["Matrice 4T"]
