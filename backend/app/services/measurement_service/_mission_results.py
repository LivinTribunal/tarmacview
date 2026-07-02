"""mission-level protocol-style aggregation - groups runs by runway/AGL/LHA.

reuses ``build_results_data`` per measured inspection; never re-pivots the blob.
every un-measured parameter serializes as explicit null / "NOT_MEASURED" so the
frontend renders placeholders that read distinct from a real FAIL.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import MeasurementStatus
from app.core.exceptions import NotFoundError
from app.models.agl import LHA
from app.models.airport import Airport
from app.models.inspection import Inspection
from app.models.measurement import Measurement
from app.models.mission import Mission
from app.schemas.mission_results import (
    DeviceEvaluationRow,
    DeviceEvaluationStr,
    DeviceResults,
    MissionGlideSlopeResult,
    MissionLightResult,
    MissionResultsHeader,
    MissionResultsResponse,
    MissionWeatherPlaceholder,
    RunwayResults,
)
from app.services.measurement_service._crud import _light_name_for
from app.services.measurement_service._results import build_results_data

# protocol rows/devices we scaffold but don't measure yet. per-light min/middle/max
# already ride on MissionLightResult, so sector widths are not a placeholder row.
PAPI_PLACEHOLDER_ROWS = (
    "chromaticity",
    "luminous_intensity",
    "coverage",
    "attenuation",
    "meht",
    "obstacle_plane_clearance",
    "ils_alignment",
)
SERVICEABILITY_PLACEHOLDER_ROWS = ("als_hi_mi", "threshold", "edge", "end", "tdz", "centerline")
PLACEHOLDER_DEVICE_TYPES = ("ALS", "RLS")


def _resolve_device(db: Session, inspection: Inspection):
    """resolve one inspection's (surface, agl) via its first target LHA - (None, None) if none."""
    lha_ids = inspection.lha_ids or []
    if not lha_ids:
        return None, None
    lhas = db.query(LHA).filter(LHA.id.in_(lha_ids)).all()
    lhas.sort(key=lambda lha: lha.sequence_number)
    if not lhas:
        return None, None
    agl = lhas[0].agl
    surface = agl.surface if agl else None
    return surface, agl


def _scaffold_lights(agl) -> list[MissionLightResult]:
    """placeholder per-light rows off the AGL's LHAs - all not_measured, no readings."""
    if agl is None:
        return []
    lights: list[MissionLightResult] = []
    for index, lha in enumerate(sorted(agl.lhas, key=lambda x: x.sequence_number)):
        lights.append(
            MissionLightResult(
                lha_id=lha.id,
                unit_designator=lha.unit_designator,
                light_name=_light_name_for(lha.unit_designator, index),
                setting_angle=lha.setting_angle,
                tolerance=lha.tolerance,
                not_measured=True,
            )
        )
    return lights


def _evaluate(lights: list[MissionLightResult]) -> DeviceEvaluationStr:
    """roll per-light verdicts into a device evaluation - mirrors the FE overall verdict."""
    scored = [light for light in lights if light.passed is not None]
    if not scored:
        return "PENDING"
    if any(light.passed is False for light in scored):
        return "FAIL"
    return "PASS"


def _measured_lights(results) -> list[MissionLightResult]:
    """merge a DONE run's reference points, summaries and light series into per-light rows."""
    summaries_by_name = {s.light_name: s for s in results.summaries}
    series_by_name = {light.light_name: light for light in results.lights}
    lights: list[MissionLightResult] = []
    for ref in results.reference_points:
        summary = summaries_by_name.get(ref.light_name)
        series = series_by_name.get(ref.light_name)
        lights.append(
            MissionLightResult(
                lha_id=ref.lha_id,
                unit_designator=ref.unit_designator,
                light_name=ref.light_name,
                setting_angle=ref.setting_angle,
                tolerance=ref.tolerance,
                measured_transition_angle=summary.measured_transition_angle if summary else None,
                transition_angle_min=series.transition_angle_min if series else None,
                transition_angle_middle=series.transition_angle_middle if series else None,
                transition_angle_max=series.transition_angle_max if series else None,
                passed=summary.passed if summary else None,
            )
        )
    return lights


def _device_label(agl, surface, inspection: Inspection) -> str:
    """human label for a device - "PAPI 06" when resolvable, else method + sequence."""
    if agl and surface:
        return f"{agl.agl_type} {surface.identifier}"
    return f"{inspection.method} #{inspection.sequence_order}"


def _device_for_inspection(
    db: Session, inspection: Inspection, measurement: Measurement | None, surface, agl
) -> DeviceResults:
    """build one DeviceResults for an inspection from its latest measurement (or none)."""
    device_type = agl.agl_type if agl else "PAPI"
    label = _device_label(agl, surface, inspection)
    base = {
        "agl_id": agl.id if agl else None,
        "device_type": device_type,
        "device_label": label,
        "inspection_id": inspection.id,
        "inspection_method": inspection.method,
        "placeholder_rows": list(PAPI_PLACEHOLDER_ROWS),
    }

    if measurement is None:
        return DeviceResults(
            **base,
            status="NOT_MEASURED",
            evaluation="NOT_MEASURED",
            lights=_scaffold_lights(agl),
        )

    if measurement.status != MeasurementStatus.DONE.value:
        return DeviceResults(
            **base,
            measurement_id=measurement.id,
            status=measurement.status,
            evaluation="PENDING",
            lights=_scaffold_lights(agl),
        )

    results = build_results_data(db, measurement.id)
    lights = _measured_lights(results)
    return DeviceResults(
        **base,
        measurement_id=measurement.id,
        status=measurement.status,
        evaluation=_evaluate(lights),
        glide_slope=MissionGlideSlopeResult(
            measured_glide_slope_angle=results.measured_glide_slope_angle,
            configured_glide_slope_angle=results.configured_glide_slope_angle,
            glide_slope_angle_tolerance=results.glide_slope_angle_tolerance,
            within_tolerance=results.glide_slope_within_tolerance,
        ),
        lights=lights,
    )


def _latest_measurements(db: Session, inspection_ids: list[UUID]) -> dict[UUID, Measurement]:
    """latest measurement per inspection in one batched newest-first query."""
    if not inspection_ids:
        return {}
    rows = (
        db.query(Measurement)
        .filter(Measurement.inspection_id.in_(inspection_ids))
        .order_by(Measurement.created_at.desc(), Measurement.id)
        .all()
    )
    latest: dict[UUID, Measurement] = {}
    for row in rows:
        latest.setdefault(row.inspection_id, row)
    return latest


def build_mission_results(db: Session, mission_id: UUID) -> MissionResultsResponse:
    """assemble the mission-scale protocol view - per runway/AGL/LHA, read-only."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if mission is None:
        raise NotFoundError("mission not found")
    airport = db.query(Airport).filter(Airport.id == mission.airport_id).first()

    inspections = sorted(mission.inspections, key=lambda i: i.sequence_order)
    latest = _latest_measurements(db, [i.id for i in inspections])

    # group devices into runway buckets, preserving first-seen order
    runways: list[RunwayResults] = []
    by_surface: dict[UUID | None, RunwayResults] = {}
    done_dates: list = []
    for inspection in inspections:
        surface, agl = _resolve_device(db, inspection)
        measurement = latest.get(inspection.id)
        if measurement is not None and measurement.status == MeasurementStatus.DONE.value:
            done_dates.append(measurement.created_at)
        device = _device_for_inspection(db, inspection, measurement, surface, agl)

        key = surface.id if surface else None
        bucket = by_surface.get(key)
        if bucket is None:
            bucket = RunwayResults(
                surface_id=surface.id if surface else None,
                runway_identifier=surface.identifier if surface else None,
                runway_heading=surface.heading if surface else None,
            )
            by_surface[key] = bucket
            runways.append(bucket)
        bucket.devices.append(device)

    # scaffold placeholder ALS/RLS devices per resolved runway
    for bucket in runways:
        if bucket.surface_id is None:
            continue
        for device_type in PLACEHOLDER_DEVICE_TYPES:
            bucket.devices.append(
                DeviceResults(
                    device_type=device_type,
                    device_label=f"{device_type} {bucket.runway_identifier}",
                    status="NOT_MEASURED",
                    evaluation="NOT_MEASURED",
                    placeholder_rows=list(SERVICEABILITY_PLACEHOLDER_ROWS),
                )
            )

    evaluation = [
        DeviceEvaluationRow(device_label=device.device_label, result=device.evaluation)
        for bucket in runways
        for device in bucket.devices
    ]

    header = MissionResultsHeader(
        airport_icao=airport.icao_code if airport else "",
        airport_name=airport.name if airport else "",
        mission_name=mission.name,
        measurement_date=max(done_dates) if done_dates else None,
        drone_model=mission.drone_profile.model if mission.drone_profile else None,
    )
    return MissionResultsResponse(
        mission_id=mission.id,
        mission_name=mission.name,
        header=header,
        weather=MissionWeatherPlaceholder(),
        runways=runways,
        evaluation=evaluation,
    )
