"""tests that all ORM tables register and create, plus airport/mission crud and cascades."""

from sqlalchemy import inspect

import app.models  # noqa: F401
from app.core.database import Base

# Test Data
EXPECTED_TABLES = {
    "airport",
    "airfield_surface",
    "obstacle",
    "safety_zone",
    "agl",
    "lha",
    "drone_profile",
    "inspection_template",
    "insp_template_targets",
    "insp_template_methods",
    "inspection_configuration",
    "mission",
    "inspection",
    "flight_plan",
    "waypoint",
    "validation_result",
    "validation_violation",
    "export_result",
    "constraint_rule",
}


# Tests
def test_all_19_tables_registered():
    """all 19 tables exist in metadata"""
    table_names = set(Base.metadata.tables.keys())

    assert EXPECTED_TABLES.issubset(table_names), f"missing: {EXPECTED_TABLES - table_names}"


def test_all_tables_created_in_database(db_engine):
    """tables are actually created in a real postgis database"""
    inspector = inspect(db_engine)
    db_tables = set(inspector.get_table_names())

    assert EXPECTED_TABLES.issubset(db_tables), f"missing: {EXPECTED_TABLES - db_tables}"


def test_airport_crud(db_session):
    """test airport CRUD operations"""
    from app.models.airport import Airport

    airport = Airport(
        icao_code="LZIB",
        name="Bratislava Airport",
        elevation=133.0,
        location="SRID=4326;POINTZ(17.2127 48.1702 133)",
    )
    db_session.add(airport)
    db_session.flush()

    result = db_session.query(Airport).filter_by(icao_code="LZIB").first()
    assert result is not None
    assert result.name == "Bratislava Airport"


def test_mission_default_status(db_session):
    """test mission default status"""
    from app.models.airport import Airport
    from app.models.mission import Mission

    airport = db_session.query(Airport).filter_by(icao_code="LZIB").first()
    if not airport:
        airport = Airport(
            icao_code="LZIB",
            name="Bratislava Airport",
            elevation=133.0,
            location="SRID=4326;POINTZ(17.2127 48.1702 133)",
        )
        db_session.add(airport)
        db_session.flush()

    mission = Mission(name="Test Mission", airport_id=airport.id)
    db_session.add(mission)
    db_session.flush()

    result = db_session.query(Mission).filter_by(name="Test Mission").first()

    assert result is not None
    assert result.status == "DRAFT"


def test_mission_constraints_outlive_flight_plan(db_session):
    """deleting a mission's flight plan leaves constraints attached to the mission."""
    from app.models.airport import Airport
    from app.models.flight_plan import AltitudeConstraint, FlightPlan
    from app.models.mission import Mission

    airport = Airport(
        icao_code="CTLS",
        name="Constraint Lifecycle",
        elevation=100.0,
        location="SRID=4326;POINTZ(17.2 48.1 100)",
    )
    db_session.add(airport)
    db_session.flush()

    mission = Mission(name="Constraint Lifecycle Mission", airport_id=airport.id)
    rule = AltitudeConstraint(
        name="ceiling",
        min_altitude=0.0,
        max_altitude=200.0,
        is_hard_constraint=False,
    )
    mission.constraints.append(rule)
    db_session.add(mission)
    db_session.flush()
    rule_id = rule.id

    fp = FlightPlan(mission_id=mission.id, airport_id=airport.id)
    db_session.add(fp)
    db_session.flush()

    db_session.delete(fp)
    db_session.flush()
    db_session.expire_all()

    refreshed = db_session.query(Mission).filter_by(id=mission.id).first()
    assert [c.id for c in refreshed.constraints] == [rule_id]


def test_mission_delete_cascades_to_constraints(db_session):
    """deleting a mission cascade-deletes its constraints."""
    from sqlalchemy import select

    from app.models.airport import Airport
    from app.models.flight_plan import ConstraintRule, SpeedConstraint
    from app.models.mission import Mission

    airport = Airport(
        icao_code="CTDC",
        name="Constraint Cascade",
        elevation=100.0,
        location="SRID=4326;POINTZ(17.2 48.1 100)",
    )
    db_session.add(airport)
    db_session.flush()

    mission = Mission(name="Cascade Test Mission", airport_id=airport.id)
    mission.constraints.append(
        SpeedConstraint(name="cap", max_horizontal_speed=10.0, is_hard_constraint=False)
    )
    db_session.add(mission)
    db_session.flush()
    mission_id = mission.id

    db_session.delete(mission)
    db_session.flush()

    remaining = db_session.execute(
        select(ConstraintRule).where(ConstraintRule.mission_id == mission_id)
    ).all()
    assert remaining == []
