"""measurement orchestration - create, first-frame detect, confirm, full processing.

works the ``Measurement`` orm row directly. stays import-safe on a backend pinned to
requirements.txt only - the opencv engine and celery are imported lazily inside the
engine/enqueue seams so ``app.main`` boots without the worker deps. this package keeps
the public import surface byte-identical to the old single module via these re-exports;
``from app.services import measurement_service`` and every ``measurement_service.X``
reference resolve unchanged. submodules: ``_crud`` (route entrypoints + ref snapshot),
``_mapping`` (orm<->wire), ``_results`` (blob pivot), ``_runners`` (worker + engine seams).
"""

from app.services import object_storage
from app.services.measurement_service._crud import (
    _boxes_from_request,
    _inspection_media_keys,
    _light_name_for,
    _list_item,
    _measurement_object_keys,
    _snapshot_reference_points,
    airport_id_for_inspection,
    confirm_lights,
    create_measurement,
    delete_measurement,
    get_measurement,
    get_preview,
    list_airport_measurements,
    update_measurement,
)
from app.services.measurement_service._mapping import (
    _reference_point_responses,
    _summary_responses,
    light_boxes_to_schema,
    to_response,
)
from app.services.measurement_service._mission_results import build_mission_results
from app.services.measurement_service._results import (
    _chromaticity_from_rgb,
    _drone_path,
    _light_series,
    _measured_glide_slope,
    _parse_rgb_floats,
    _rgb_channels,
    build_results_data,
)
from app.services.measurement_service._runners import (
    _IN_PROGRESS_STATUSES,
    _MEASUREMENT_PREFIX,
    _boxes_from_detection,
    _json_default,
    _mark_failed,
    _measured_transition_angles,
    _upload_annotated_videos,
    enqueue_first_frame,
    enqueue_processing,
    extract_first_frame_and_detect,
    extract_gps_data,
    reap_stale_runs,
    run_first_frame,
    run_processing,
    run_two_pass_processing,
)

__all__ = [
    "object_storage",
    # crud / route entrypoints
    "create_measurement",
    "get_measurement",
    "list_airport_measurements",
    "airport_id_for_inspection",
    "get_preview",
    "confirm_lights",
    "update_measurement",
    "delete_measurement",
    # orm <-> wire mapping
    "light_boxes_to_schema",
    "to_response",
    # results
    "build_results_data",
    "build_mission_results",
    # worker runners + seams
    "run_first_frame",
    "run_processing",
    "reap_stale_runs",
    "enqueue_first_frame",
    "enqueue_processing",
    "extract_first_frame_and_detect",
    "extract_gps_data",
    "run_two_pass_processing",
    # internals re-exported for tests / seam patching
    "_IN_PROGRESS_STATUSES",
    "_MEASUREMENT_PREFIX",
    "_boxes_from_detection",
    "_boxes_from_request",
    "_chromaticity_from_rgb",
    "_drone_path",
    "_inspection_media_keys",
    "_json_default",
    "_light_name_for",
    "_light_series",
    "_list_item",
    "_mark_failed",
    "_measured_glide_slope",
    "_measured_transition_angles",
    "_measurement_object_keys",
    "_parse_rgb_floats",
    "_reference_point_responses",
    "_rgb_channels",
    "_snapshot_reference_points",
    "_summary_responses",
    "_upload_annotated_videos",
]
