"""
Geographic and geometric calculation utilities

IMPORTANT: All elevation/altitude values in this module are WGS84 ellipsoid heights in meters.
- All distance calculations return meters
- All angle calculations return degrees
- GPS altitude is WGS84 ellipsoid height (not MSL/orthometric height)
"""

import logging
import math
from typing import Dict

import numpy as np

from app.services.video_processing.config import settings

logger = logging.getLogger(__name__)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on Earth (in meters)"""
    # Convert to float in case values come from DynamoDB as Decimal
    lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)

    R = settings.EARTH_RADIUS_METERS

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2) * math.sin(delta_phi / 2) + math.cos(phi1) * math.cos(
        phi2
    ) * math.sin(delta_lambda / 2) * math.sin(delta_lambda / 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the bearing (forward azimuth) from point 1 to point 2.
    Returns bearing in degrees (0-360), where 0 = North, 90 = East, 180 = South, 270 = West.
    """
    # Convert to float in case values come from DynamoDB as Decimal
    lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)

    bearing_rad = math.atan2(y, x)
    bearing_deg = math.degrees(bearing_rad)

    # Normalize to 0-360
    bearing_deg = (bearing_deg + 360) % 360

    return bearing_deg


def calculate_horizontal_angle(
    target_lat: float, target_lon: float, drone_lat: float, drone_lon: float, runway_heading: float
) -> float:
    """
    Calculate the horizontal angle between the runway centerline and the drone position.

    The angle is measured at the light/touch point, between the runway centerline
    (which extends in both directions) and the line to the drone position.
    Positive angles mean drone is to the right of the
    centerline when looking along the runway heading.
    Negative angles mean drone is to the left of the centerline.

    Args:
        target_lat: Latitude of the light/touch point
        target_lon: Longitude of the light/touch point
        drone_lat: Latitude of the drone
        drone_lon: Longitude of the drone
        runway_heading: Runway heading in degrees (0-360)

    Returns:
        Horizontal angle in degrees (-90 to +90), with 3 decimal places precision
    """
    # Convert to float in case values come from DynamoDB as Decimal
    target_lat, target_lon = float(target_lat), float(target_lon)
    drone_lat, drone_lon = float(drone_lat), float(drone_lon)
    runway_heading = float(runway_heading)

    # Calculate bearing from target to drone
    bearing_to_drone = calculate_bearing(target_lat, target_lon, drone_lat, drone_lon)

    # Calculate angle difference from runway heading
    angle_diff = bearing_to_drone - runway_heading

    # Normalize to -180 to +180 range
    if angle_diff > 180:
        angle_diff -= 360
    elif angle_diff < -180:
        angle_diff += 360

    # The runway centerline extends in both directions (heading and heading + 180°)
    # We want the angle to the nearest side of this line, so clamp to -90 to +90
    if angle_diff > 90:
        angle_diff = 180 - angle_diff
    elif angle_diff < -90:
        angle_diff = -180 - angle_diff

    # Round to 3 decimal places for high precision
    return round(angle_diff, 3)


def calculate_angle(drone_data: Dict, light_pos: Dict) -> float:
    """
    Calculate angle between drone and light using GPS coordinates.

    All elevations use WGS84 ellipsoid height from drone GPS - no conversions are performed.

    Args:
        drone_data: Dictionary containing drone GPS data with 'latitude', 'longitude',
                   and 'elevation_wgs84' (WGS84 ellipsoid height in meters)
        light_pos: Dictionary containing PAPI light position with 'latitude', 'longitude',
                  and 'elevation_wgs84' (WGS84 ellipsoid height in meters)

    Returns:
        Vertical angle in degrees (positive when drone is above PAPI)
    """
    try:
        # Get drone position (all elevations in WGS84)
        drone_lat = float(drone_data.get("latitude"))
        drone_lon = float(drone_data.get("longitude"))
        elevation_value = drone_data.get("elevation_wgs84") or drone_data.get("elevation") or 100
        drone_elevation_wgs84 = float(elevation_value)

        # Get PAPI light position (from reference points) - all elevations in WGS84
        papi_lat = float(light_pos.get("latitude"))
        papi_lon = float(light_pos.get("longitude"))
        papi_elevation_value = light_pos.get("elevation_wgs84") or light_pos.get("elevation") or 0
        papi_elevation_wgs84 = float(papi_elevation_value)

        # Validate elevation data
        if papi_elevation_wgs84 == 0 or papi_elevation_wgs84 is None:
            logger.warning(
                f"PAPI elevation_wgs84 is {papi_elevation_wgs84}m - may cause incorrect angles"
            )

        if None in [drone_lat, drone_lon, papi_lat, papi_lon]:
            raise ValueError("GPS coordinates are required for accurate PAPI angle calculation")

        # Calculate ground distance using Haversine formula
        ground_dist = haversine_distance(drone_lat, drone_lon, papi_lat, papi_lon)

        # Calculate height difference (both elevations in WGS84)
        height_diff = drone_elevation_wgs84 - papi_elevation_wgs84

        # Calculate angle (elevation angle from horizontal)
        if ground_dist > 0:
            angle_rad = np.arctan(height_diff / ground_dist)
            angle = np.degrees(angle_rad)
        else:
            angle = 90.0 if height_diff > 0 else -90.0

        # Round to 3 decimal places for consistent precision with horizontal angles
        return round(angle, 3)

    except Exception as e:
        logger.error("=" * 80)
        logger.error(f"❌ EXCEPTION IN calculate_angle: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback

        logger.error(f"Traceback:\n{traceback.format_exc()}")
        logger.error("=" * 80)
        return 0.0


def calculate_ground_distance(drone_data: Dict, light_pos: Dict) -> float:
    """Calculate ground distance between drone and light using GPS"""
    try:
        drone_lat = drone_data.get("latitude")
        drone_lon = drone_data.get("longitude")
        papi_lat = light_pos.get("latitude")
        papi_lon = light_pos.get("longitude")

        if None in [drone_lat, drone_lon, papi_lat, papi_lon]:
            return settings.DEFAULT_FALLBACK_DISTANCE

        # Convert to float in case values come from DynamoDB as Decimal
        drone_lat, drone_lon = float(drone_lat), float(drone_lon)
        papi_lat, papi_lon = float(papi_lat), float(papi_lon)

        return haversine_distance(drone_lat, drone_lon, papi_lat, papi_lon)

    except Exception as e:
        logger.warning(f"Error calculating ground distance: {e}")
        return settings.DEFAULT_FALLBACK_DISTANCE


def calculate_direct_distance(drone_data: Dict, light_pos: Dict) -> float:
    """
    Calculate direct 3D distance between drone and light.

    All elevations use WGS84 ellipsoid height from drone GPS.
    """
    try:
        ground_dist = calculate_ground_distance(drone_data, light_pos)

        # Convert to float in case values come from DynamoDB as Decimal
        drone_elevation_wgs84 = float(
            drone_data.get("elevation_wgs84", drone_data.get("elevation", 100))
        )
        papi_elevation_wgs84 = float(
            light_pos.get("elevation_wgs84", light_pos.get("elevation", 0))
        )
        height_diff = drone_elevation_wgs84 - papi_elevation_wgs84

        return math.sqrt(ground_dist**2 + height_diff**2)

    except Exception as e:
        logger.warning(f"Error calculating direct distance: {e}")
        return settings.DEFAULT_FALLBACK_DISTANCE
