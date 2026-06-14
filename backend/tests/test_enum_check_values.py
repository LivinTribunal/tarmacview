"""enum_check_values renders sql check-constraint value lists."""

from app.core.enums import (
    MediaFileStatus,
    ObstacleType,
    SafetyZoneType,
    TerrainSource,
    enum_check_values,
)


def test_renders_quoted_comma_joined_values_in_order():
    """each member value is single-quoted and comma-space joined in order."""
    assert enum_check_values(TerrainSource) == "'FLAT', 'DEM_UPLOAD', 'DEM_API', 'DEM_SRTM'"


def test_matches_media_file_status_constraint_body():
    """media-file status list stays byte-identical to the old inline join."""
    assert enum_check_values(MediaFileStatus) == "'RECEIVED', 'MATCHED', 'UNASSIGNED', 'INGESTED'"


def test_covers_obstacle_and_safety_zone():
    """obstacle + safety-zone enums render every member."""
    assert (
        enum_check_values(ObstacleType) == "'BUILDING', 'TOWER', 'ANTENNA', 'VEGETATION', 'OTHER'"
    )
    assert enum_check_values(SafetyZoneType) == (
        "'CTR', 'RESTRICTED', 'PROHIBITED', 'TEMPORARY_NO_FLY', 'AIRPORT_BOUNDARY'"
    )
