import { useState, useEffect, useCallback, useRef } from "react";

import type {
  MissionDetailResponse,
  MissionUpdate,
} from "@/types/mission";
import type { AirportDetailResponse } from "@/types/airport";
import { MapTool } from "@/hooks/useMapTools";
import { computePlacementUpdates } from "@/utils/takeoffLandingPlacement";
import { useElevationResolver } from "@/hooks/useElevationResolver";
import { pointsEqual } from "@/utils/coordinateEquality";

interface UseTakeoffLandingPickerParams {
  mission: MissionDetailResponse | null;
  missionDirty: Partial<MissionUpdate>;
  airportDetail: AirportDetailResponse | null;
  handleMissionChange: (update: Partial<MissionUpdate>) => void;
}

interface TakeoffLandingPickerReturn {
  pickingCoord: "takeoff" | "landing" | null;
  setPickingCoord: React.Dispatch<
    React.SetStateAction<"takeoff" | "landing" | null>
  >;
  useTakeoffAsLanding: boolean;
  setUseTakeoffAsLanding: React.Dispatch<React.SetStateAction<boolean>>;
  handleMapClick: (lngLat: { lng: number; lat: number }) => Promise<void>;
}

/** owns pick-on-map coord state, round-trip mirror, and the map click handler. */
export default function useTakeoffLandingPicker({
  mission,
  missionDirty,
  airportDetail,
  handleMissionChange,
}: UseTakeoffLandingPickerParams): TakeoffLandingPickerReturn {
  // coordinate pick-on-map mode
  const [pickingCoord, setPickingCoord] = useState<"takeoff" | "landing" | null>(null);
  // round-trip mission toggle lifted from form so pick-on-map clicks can mirror
  // derived from mission data on load so the setting survives reloads without a db column
  const [useTakeoffAsLanding, setUseTakeoffAsLanding] = useState(false);
  const lastDerivedMissionIdRef = useRef<string | null>(null);

  // derive round-trip toggle from persisted coordinates on mission load
  // re-derives only when mission id changes so it doesn't fight mid-edit
  useEffect(() => {
    if (!mission) return;
    if (lastDerivedMissionIdRef.current === mission.id) return;
    lastDerivedMissionIdRef.current = mission.id;
    setUseTakeoffAsLanding(
      pointsEqual(mission.takeoff_coordinate, mission.landing_coordinate),
    );
  }, [mission]);

  // use refs for map click to avoid stale closures and excess re-renders
  const pickingCoordRef = useRef(pickingCoord);
  pickingCoordRef.current = pickingCoord;
  const missionDirtyRef = useRef(missionDirty);
  missionDirtyRef.current = missionDirty;
  const missionRef = useRef(mission);
  missionRef.current = mission;
  const airportDetailRef = useRef(airportDetail);
  airportDetailRef.current = airportDetail;
  const useTakeoffAsLandingRef = useRef(useTakeoffAsLanding);
  useTakeoffAsLandingRef.current = useTakeoffAsLanding;
  // memoized per airport so the click handler can capture it via ref without
  // invalidating the [] dep array.
  const resolveElevation = useElevationResolver(
    airportDetail?.id ?? mission?.airport_id ?? null,
  );
  const resolveElevationRef = useRef(resolveElevation);
  resolveElevationRef.current = resolveElevation;
  const handleMissionChangeRef = useRef(handleMissionChange);
  handleMissionChangeRef.current = handleMissionChange;

  const handleMapClick = useCallback(
    async (lngLat: { lng: number; lat: number }) => {
      /** set takeoff or landing coordinate from map click, mirroring into landing when round-trip mode is on. */
      const target = pickingCoordRef.current;
      if (!target) return;

      const dirty = missionDirtyRef.current;
      const m = missionRef.current;
      const tool = target === "takeoff" ? MapTool.PLACE_TAKEOFF : MapTool.PLACE_LANDING;
      const update = await computePlacementUpdates(
        tool,
        lngLat,
        {
          takeoff_coordinate: dirty.takeoff_coordinate ?? m?.takeoff_coordinate ?? null,
          landing_coordinate: dirty.landing_coordinate ?? m?.landing_coordinate ?? null,
        },
        airportDetailRef.current?.elevation ?? null,
        useTakeoffAsLandingRef.current,
        resolveElevationRef.current,
      );
      if (update) handleMissionChangeRef.current(update);
      setPickingCoord(null);
    },
    [],
  );

  return {
    pickingCoord,
    setPickingCoord,
    useTakeoffAsLanding,
    setUseTakeoffAsLanding,
    handleMapClick,
  };
}
