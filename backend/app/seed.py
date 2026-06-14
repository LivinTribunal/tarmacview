"""database seeding: airports from openaip, drone profiles, inspection templates."""

import logging
from uuid import UUID

from app.core.constants import DEFAULT_BUFFER_DISTANCE_M
from app.core.database import SessionLocal
from app.models.airport import AirfieldSurface, Airport, Obstacle, SafetyZone
from app.models.inspection import (
    InspectionConfiguration,
    InspectionTemplate,
    insp_template_methods,
)
from app.models.mission import DroneProfile
from app.models.user import User
from app.schemas.openaip import AirportLookupResponse
from app.services.geometry_converter import geojson_to_wkt
from app.services.openaip_service import lookup_airport_by_icao

logger = logging.getLogger(__name__)

AIRPORTS = ["LKPR", "LZIB", "LOWW", "LZKZ", "LZTT"]

# real-world drone specs sourced from manufacturer pages. values reflect
# the stock/standard payload (H20T for M300, H30T for M350, L1D-20c for
# mavic 2 pro, 4/3 wide for m3e, S.O.D.A. 3D for ebee x, LR1 + sigma 24mm
# for astro, VT300 wide for x10). max_altitude is the manufacturer service
# ceiling consumed by the safety validator, NOT the operational/regulatory
# cap. sensor_fov is the diagonal FOV at 1x zoom of the primary EO camera.
DRONE_PROFILES = [
    {
        "name": "DJI Matrice 300 RTK",
        "manufacturer": "DJI",
        "model": "Matrice 300 RTK",
        "max_speed": 23.0,
        "max_climb_rate": 6.0,
        # service ceiling above sea level, standard 2110 propellers
        "max_altitude": 5000.0,
        "battery_capacity": 5935.0,
        "endurance_minutes": 55.0,
        # h20t wide-angle EO camera (12 MP, 1/2.3" CMOS)
        "camera_resolution": "12MP",
        "camera_frame_rate": 30,
        # h20t diagonal FOV
        "sensor_fov": 82.9,
        "weight": 6.3,
        # h20t wide-angle 1x physical focal length (mm)
        "sensor_base_focal_length": 4.5,
    },
    {
        "name": "DJI Matrice 350 RTK",
        "manufacturer": "DJI",
        "model": "Matrice 350 RTK",
        "max_speed": 23.0,
        "max_climb_rate": 6.0,
        # service ceiling above sea level, standard 2110s propellers
        "max_altitude": 5000.0,
        "battery_capacity": 5880.0,
        "endurance_minutes": 55.0,
        # h30t wide-angle EO camera (48 MP, 1/1.3" CMOS)
        "camera_resolution": "48MP",
        "camera_frame_rate": 30,
        # h30t diagonal FOV
        "sensor_fov": 82.1,
        "weight": 6.47,
        # h30t wide-angle 1x physical focal length (mm)
        "sensor_base_focal_length": 6.72,
    },
    {
        "name": "DJI Matrice 4T",
        "manufacturer": "DJI",
        # this string is also the key in app.core.constants.DJI_WPML_ENUMS,
        # so the kmz/wpml exporter resolves the right drone+payload enums
        "model": "Matrice 4T",
        # forward horizontal speed; sideways 19, backward 18
        "max_speed": 21.0,
        # standard propellers; drops to 6 m/s with accessory payloads
        "max_climb_rate": 10.0,
        # service ceiling above sea level
        "max_altitude": 6000.0,
        # 6741 mAh @ 14.76 V nominal, 99.5 Wh
        "battery_capacity": 6741.0,
        # standard props, no payload, no wind, 8 m/s cruise
        "endurance_minutes": 49.0,
        # FH2 wide EO camera, 1/1.3" CMOS
        "camera_resolution": "48MP",
        "camera_frame_rate": 30,
        # FH2 wide diagonal FOV (DJI publishes 82 deg, unqualified)
        "sensor_fov": 82.0,
        # takeoff weight with propellers, battery, microSD; MTOW 1.42 kg
        "weight": 1.22,
        # FH2 wide 1x focal length (mm), derived from 24 mm 35mm-equiv on
        # a 1/1.3" sensor; dji does not publish physical FL
        "sensor_base_focal_length": 5.33,
    },
    {
        "name": "DJI Mavic 2 Pro",
        "manufacturer": "DJI",
        "model": "Mavic 2 Pro",
        "max_speed": 20.0,
        "max_climb_rate": 5.0,
        # max takeoff altitude above sea level
        "max_altitude": 6000.0,
        "battery_capacity": 3850.0,
        "endurance_minutes": 31.0,
        "camera_resolution": "20MP",
        # 4k @ 30 fps capture cap; 120 fps is 1080p slow-mo only
        "camera_frame_rate": 30,
        "sensor_fov": 77.0,
        "weight": 0.907,
        # hasselblad l1d-20c 1x physical focal length (mm), derived from
        # 13.2 mm sensor width / 28 mm 35mm-equiv
        "sensor_base_focal_length": 10.26,
    },
    {
        "name": "DJI Mavic 3 Enterprise",
        "manufacturer": "DJI",
        "model": "Mavic 3 Enterprise",
        "max_speed": 21.0,
        "max_climb_rate": 8.0,
        # max takeoff altitude above sea level, no payload
        "max_altitude": 6000.0,
        "battery_capacity": 5000.0,
        "endurance_minutes": 45.0,
        "camera_resolution": "20MP",
        "camera_frame_rate": 30,
        "sensor_fov": 84.0,
        # dji-stated 915 g aircraft weight (kg)
        "weight": 0.915,
        # 4/3 cmos wide camera 1x physical focal length (mm)
        "sensor_base_focal_length": 12.29,
    },
    {
        "name": "Autel EVO II Pro V3",
        "manufacturer": "Autel Robotics",
        "model": "EVO II Pro V3",
        "max_speed": 20.0,
        "max_climb_rate": 8.0,
        # max service ceiling above sea level
        "max_altitude": 5000.0,
        "battery_capacity": 7100.0,
        # autel user manual flight-time figure, no wind, no payload
        "endurance_minutes": 40.0,
        "camera_resolution": "20MP",
        "camera_frame_rate": 30,
        "sensor_fov": 82.0,
        # no-payload takeoff weight (kg); MTOW with stock kit is 1.27 kg
        "weight": 1.191,
        # autel does not publish physical focal length; only 29 mm 35mm-equiv
    },
    {
        "name": "Freefly Astro",
        "manufacturer": "Freefly Systems",
        "model": "Astro",
        # freefly position-mode cap; manual mode is unlimited
        "max_speed": 15.0,
        "max_climb_rate": 4.0,
        # base astro has no published service ceiling; using the astro max
        # high-altitude-mode rating as the conservative platform ceiling
        "max_altitude": 4500.0,
        # SL8-Air pack capacity; astro flies on two packs in parallel
        "battery_capacity": 7300.0,
        # current freefly knowledge-base figure, no payload, base astro
        "endurance_minutes": 37.0,
        # stock LR1 mapping payload (sony ILX-LR1)
        "camera_resolution": "61MP",
        "camera_frame_rate": 30,
        # diagonal FOV of stock sigma 24 mm f/3.5 on full-frame
        "sensor_fov": 84.0,
        # all-up airframe weight per freefly performance docs (kg)
        "weight": 6.95,
        # stock sigma 24 mm fp DG DN i C lens physical focal length (mm)
        "sensor_base_focal_length": 24.0,
    },
    {
        "name": "senseFly eBee X",
        "manufacturer": "senseFly",
        "model": "eBee X",
        # ageagle brochure max cruise speed (110 km/h)
        "max_speed": 30.0,
        # fixed-wing climb rate, internal estimate; not officially published
        "max_climb_rate": 4.0,
        # senseFly-tested service ceiling for the ebee family (takeoff alt)
        "max_altitude": 4000.0,
        # endurance battery pack (4900 mAh, 15.2 V LiHV) pairs with 90 min
        "battery_capacity": 4900.0,
        "endurance_minutes": 90.0,
        # senseFly S.O.D.A. 3D photogrammetry payload (1" sensor)
        "camera_resolution": "20MP",
        # stills-only photogrammetry capture, ~1 Hz
        "camera_frame_rate": 1,
        # S.O.D.A. 3D optical FOV (mechanical orientation extends to 154 deg total)
        "sensor_fov": 64.0,
        "weight": 1.6,
        # S.O.D.A. 3D 1x physical focal length (mm)
        "sensor_base_focal_length": 10.6,
    },
    {
        "name": "Skydio X10",
        "manufacturer": "Skydio",
        "model": "X10",
        "max_speed": 20.0,
        "max_climb_rate": 6.0,
        # max density altitude per skydio tech specs
        "max_altitude": 4572.0,
        # rev 2 flight battery (17.5 V, 154 Wh)
        "battery_capacity": 8800.0,
        "endurance_minutes": 40.0,
        # VT300 wide camera (1" CMOS), shared across X10 sensor packages
        "camera_resolution": "50MP",
        # skydio FAQ: 4K @ 30 fps cap; the 60 fps figure in reviews is unofficial
        "camera_frame_rate": 30,
        # VT300 wide-lens diagonal FOV
        "sensor_fov": 93.0,
        # aircraft weight with batteries, no payload (kg)
        "weight": 2.11,
        # VT300 wide-lens physical focal length (mm)
        "sensor_base_focal_length": 8.0,
    },
]


def _to_wkt(geojson: dict) -> str:
    """convert a geojson geometry dict to a WKT string."""
    return geojson_to_wkt(geojson)


def _seed_runways(data: AirportLookupResponse, airport_id: UUID) -> list[AirfieldSurface]:
    """map openaip runway data to AirfieldSurface rows (not persisted)."""
    return [
        AirfieldSurface(
            airport_id=airport_id,
            identifier=rw.identifier,
            surface_type="RUNWAY",
            geometry=_to_wkt(rw.geometry.model_dump()),
            boundary=_to_wkt(rw.boundary.model_dump()),
            heading=rw.heading,
            length=rw.length,
            width=rw.width,
            threshold_position=_to_wkt(rw.threshold_position.model_dump()),
            end_position=_to_wkt(rw.end_position.model_dump()),
        )
        for rw in data.runways
    ]


def _seed_obstacles(data: AirportLookupResponse, airport_id: UUID) -> list[Obstacle]:
    """map openaip obstacle data to Obstacle rows, z-falling-back to airport elevation."""
    obstacles = []
    for obs in data.obstacles:
        bnd = obs.boundary.model_dump()
        ring = bnd["coordinates"][0]
        centroid_lon, centroid_lat, centroid_z = Obstacle.centroid_from_boundary_ring(ring)
        if centroid_z == 0.0:
            centroid_z = data.elevation

        obstacles.append(
            Obstacle(
                airport_id=airport_id,
                name=obs.name,
                height=obs.height,
                boundary=_to_wkt(bnd),
                position=f"POINT Z ({centroid_lon} {centroid_lat} {centroid_z})",
                radius=3.0,
                buffer_distance=DEFAULT_BUFFER_DISTANCE_M,
                type=obs.type,
            )
        )
    return obstacles


def _seed_zones(data: AirportLookupResponse, airport_id: UUID) -> list[SafetyZone]:
    """map openaip safety-zone data to SafetyZone rows (not persisted)."""
    return [
        SafetyZone(
            airport_id=airport_id,
            name=sz.name,
            type=sz.type,
            geometry=_to_wkt(sz.geometry.model_dump()),
            altitude_floor=sz.altitude_floor or 0.0,
            altitude_ceiling=sz.altitude_ceiling or 0.0,
            is_active=True,
        )
        for sz in data.safety_zones
    ]


def seed_airport(icao: str) -> None:
    """seed a single airport with infrastructure from openaip."""
    db = SessionLocal()
    try:
        existing = db.query(Airport).filter_by(icao_code=icao).first()
        if existing:
            print(f"  {icao} already seeded, skipping")
            return

        print(f"  {icao} - fetching from openaip...")
        data = lookup_airport_by_icao(icao)

        airport = Airport(
            icao_code=data.icao_code,
            name=data.name,
            city=data.city,
            country=data.country,
            elevation=data.elevation,
            location=_to_wkt(data.location.model_dump()),
        )
        db.add(airport)
        db.flush()

        runways = _seed_runways(data, airport.id)
        obstacles = _seed_obstacles(data, airport.id)
        zones = _seed_zones(data, airport.id)
        for row in (*runways, *obstacles, *zones):
            db.add(row)

        # mirror seed_users - assign the new airport to every existing user so
        # seeding after first server start does not ship an orphaned airport
        users = db.query(User).all()
        for user in users:
            user.airports.append(airport)

        db.commit()
        print(
            f"  {icao} seeded: {len(runways)} runways, "
            f"{len(obstacles)} obstacles, {len(zones)} safety zones, "
            f"assigned to {len(users)} users"
        )
    except Exception as e:
        db.rollback()
        print(f"  {icao} failed: {e}")
    finally:
        db.close()


def seed_airports() -> None:
    """seed all airports from openaip."""
    print("seeding airports from openaip...")
    for icao in AIRPORTS:
        seed_airport(icao)


def seed_drone_profiles() -> None:
    """seed real-world drone profiles with full specs."""
    db = SessionLocal()
    try:
        existing = db.query(DroneProfile).filter_by(name="DJI Matrice 300 RTK").first()
        if existing:
            print("drone profiles already seeded")
            return

        for profile in DRONE_PROFILES:
            db.add(DroneProfile(**profile))

        db.commit()
        print(f"{len(DRONE_PROFILES)} drone profiles seeded")
    finally:
        db.close()


def seed_inspection_templates() -> None:
    """seed inspection templates for horizontal range and vertical profile methods."""
    db = SessionLocal()
    try:
        existing = db.query(InspectionTemplate).filter_by(name="Horizontal Range").first()
        if existing:
            print("inspection templates already seeded")
            return

        sweep_config = InspectionConfiguration(
            altitude_offset=0.0,
            measurement_density=10,
        )
        db.add(sweep_config)
        db.flush()

        sweep = InspectionTemplate(
            name="Horizontal Range",
            description="horizontal range inspection for PAPI systems",
            default_config_id=sweep_config.id,
            created_by="system",
        )
        db.add(sweep)
        db.flush()

        db.execute(
            insp_template_methods.insert().values(template_id=sweep.id, method="HORIZONTAL_RANGE")
        )

        vp_config = InspectionConfiguration(
            altitude_offset=0.0,
            measurement_density=8,
        )
        db.add(vp_config)
        db.flush()

        vp = InspectionTemplate(
            name="PAPI Vertical Profile",
            description="vertical profile inspection for PAPI systems",
            default_config_id=vp_config.id,
            created_by="system",
        )
        db.add(vp)
        db.flush()

        db.execute(
            insp_template_methods.insert().values(template_id=vp.id, method="VERTICAL_PROFILE")
        )

        db.commit()
        print("inspection templates seeded (horizontal range + vertical profile)")
    finally:
        db.close()


def seed_single_drone(name: str):
    """seed a single drone profile by name if it doesn't exist."""
    profile = next((p for p in DRONE_PROFILES if p["name"] == name), None)
    if not profile:
        print(f"no profile named '{name}' in DRONE_PROFILES")
        return

    db = SessionLocal()
    try:
        existing = db.query(DroneProfile).filter_by(name=name).first()
        if existing:
            print(f"'{name}' already exists, skipping")
            return

        db.add(DroneProfile(**profile))
        db.commit()
        print(f"'{name}' seeded")
    finally:
        db.close()


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING)

    if len(sys.argv) > 1 and sys.argv[1] == "--drone":
        drone_name = " ".join(sys.argv[2:])
        seed_single_drone(drone_name)
    else:
        seed_airports()
        seed_drone_profiles()
        seed_inspection_templates()
