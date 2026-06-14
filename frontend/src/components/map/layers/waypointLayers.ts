// re-export barrel - keeps the historic `.../layers/waypointLayers` import
// path stable after the split into full / simplified / shared modules. the
// colour / key / label helpers (coordKey, segmentKey, offsetSegmentLeft,
// resolveWaypointColor, resolveSegmentColor, resolveLabel, TRANSIT_PATH_COLOR,
// DEFAULT_MEASUREMENT_COLOR) stay internal to ./waypoint - they were
// file-private in the old waypointLayers.ts and are deliberately not surfaced
// here, exactly as `toRad` stayed internal in the geo split.

export {
  WAYPOINT_SOURCE,
  WAYPOINT_LINE_SOURCE,
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_LABEL_LAYER,
  WAYPOINT_LINE_LAYER,
  WAYPOINT_SELECTED_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_HOVER_LAYER,
  WAYPOINT_RECORDING_BOOKEND_LAYER,
  WAYPOINT_CAMERA_LINE_LAYER,
  WAYPOINT_ARROW_LAYER,
  WAYPOINT_CAMERA_TARGET_LAYER,
  WAYPOINT_TRANSIT_HIT_LAYER,
  WAYPOINT_GHOST_TRANSIT_SOURCE,
  WAYPOINT_GHOST_TRANSIT_LAYER,
  WAYPOINT_WARNING_HIGHLIGHT_LAYER,
  WAYPOINT_INSPECTION_HIGHLIGHT_LAYER,
  addWaypointLayers,
  updateSelectedFilter,
  updateInspectionHighlightFilter,
  updateWarningHighlightFilter,
  removeWaypointLayers,
  getWaypointLayerIds,
} from "./waypoint/waypointFullLayers";

export {
  waypointsToGeoJSON,
  waypointsToLineGeoJSON,
  waypointsToCameraLineGeoJSON,
  waypointsToCameraTargetGeoJSON,
} from "./waypoint/waypointFullGeoJSON";

export {
  SIMPLIFIED_LINE_SOURCE,
  SIMPLIFIED_LINE_LAYER,
  SIMPLIFIED_TAKEOFF_SOURCE,
  SIMPLIFIED_LANDING_SOURCE,
  SIMPLIFIED_TAKEOFF_LAYER,
  SIMPLIFIED_LANDING_LAYER,
  SIMPLIFIED_CORNERS_SOURCE,
  SIMPLIFIED_MEASUREMENT_SOURCE,
  SIMPLIFIED_MEASUREMENT_LAYER,
  SIMPLIFIED_CORNERS_LAYER,
  SIMPLIFIED_BOOKEND_SOURCE,
  SIMPLIFIED_BOOKEND_LAYER,
  SIMPLIFIED_WARNING_HIGHLIGHT_LAYER,
  getSimplifiedTrajectoryLayerIds,
  waypointsToSimplifiedLineGeoJSON,
  waypointsToSimplifiedCornersGeoJSON,
  waypointsToSimplifiedMeasurementGeoJSON,
  waypointsToSimplifiedBookendGeoJSON,
  addSimplifiedTrajectoryLayers,
  removeSimplifiedTrajectoryLayers,
} from "./waypoint/waypointSimplifiedLayers";
