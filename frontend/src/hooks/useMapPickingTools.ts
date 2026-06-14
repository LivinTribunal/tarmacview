import { useState, useCallback, useEffect } from "react";
import maplibregl from "maplibre-gl";

import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import { roundCoord } from "@/utils/coordRounding";

interface PickedCoord {
  lat: number;
  lon: number;
  alt: number;
}

interface PickedLhaCoord {
  which: "first" | "last";
  lat: number;
  lon: number;
  alt: number;
}

interface UseMapPickingToolsParams {
  selectedFeature: MapFeature | null;
  airport: AirportDetailResponse | null;
  pendingGeometry: GeoJSON.Polygon | null;
  pendingPointPosition: [number, number] | undefined;
  getMap: () => maplibregl.Map | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

interface MapPickingToolsReturn {
  pickingTouchpoint: boolean;
  setPickingTouchpoint: React.Dispatch<React.SetStateAction<boolean>>;
  pickedTouchpointCoord: PickedCoord | null;
  setPickedTouchpointCoord: React.Dispatch<React.SetStateAction<PickedCoord | null>>;
  pickingLha: "first" | "last" | null;
  setPickingLha: React.Dispatch<React.SetStateAction<"first" | "last" | null>>;
  pickedLhaCoord: PickedLhaCoord | null;
  setPickedLhaCoord: React.Dispatch<React.SetStateAction<PickedLhaCoord | null>>;
  pickingThreshold: boolean;
  setPickingThreshold: React.Dispatch<React.SetStateAction<boolean>>;
  pickedThresholdCoord: PickedCoord | null;
  setPickedThresholdCoord: React.Dispatch<React.SetStateAction<PickedCoord | null>>;
  pickingEnd: boolean;
  setPickingEnd: React.Dispatch<React.SetStateAction<boolean>>;
  pickedEndCoord: PickedCoord | null;
  setPickedEndCoord: React.Dispatch<React.SetStateAction<PickedCoord | null>>;
  anyPicking: boolean;
  handlePickingMapClick: (lngLat: { lng: number; lat: number }) => boolean;
}

/** owns touchpoint/threshold/end/lha pick state, the pick click branch, and preview markers. */
export default function useMapPickingTools({
  selectedFeature,
  airport,
  pendingGeometry,
  pendingPointPosition,
  getMap,
  t,
}: UseMapPickingToolsParams): MapPickingToolsReturn {
  const [pickingTouchpoint, setPickingTouchpoint] = useState(false);
  const [pickedTouchpointCoord, setPickedTouchpointCoord] = useState<PickedCoord | null>(null);
  const [touchpointPickedMarker, setTouchpointPickedMarker] = useState<[number, number] | null>(null);
  const [pickingLha, setPickingLha] = useState<"first" | "last" | null>(null);
  const [pickedLhaCoord, setPickedLhaCoord] = useState<PickedLhaCoord | null>(null);
  const [lhaPickedMarkers, setLhaPickedMarkers] = useState<{
    first: [number, number] | null;
    last: [number, number] | null;
  }>({ first: null, last: null });
  const [pickingThreshold, setPickingThreshold] = useState(false);
  const [pickedThresholdCoord, setPickedThresholdCoord] = useState<PickedCoord | null>(null);
  const [thresholdPickedMarker, setThresholdPickedMarker] = useState<[number, number] | null>(null);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [pickedEndCoord, setPickedEndCoord] = useState<PickedCoord | null>(null);
  const [endPickedMarker, setEndPickedMarker] = useState<[number, number] | null>(null);

  const handlePickingMapClick = useCallback(
    (lngLat: { lng: number; lat: number }): boolean => {
      /** consume a map click for an active pick tool; returns true when handled. */
      if (pickingLha && selectedFeature?.type === "agl") {
        const agl = selectedFeature.data as { position: { coordinates: [number, number, number] } };
        const aglAlt = agl.position?.coordinates?.[2] ?? airport?.elevation ?? 0;
        setPickedLhaCoord({
          which: pickingLha,
          lat: lngLat.lat,
          lon: lngLat.lng,
          alt: aglAlt,
        });
        setLhaPickedMarkers((prev) => ({
          ...prev,
          [pickingLha]: [lngLat.lng, lngLat.lat] as [number, number],
        }));
        setPickingLha(null);
        return true;
      }

      if (pickingThreshold && selectedFeature?.type === "surface") {
        const surface = selectedFeature.data as { surface_type: string; threshold_position?: { coordinates: number[] } | null };
        if (surface.surface_type === "RUNWAY") {
          const lat = roundCoord(lngLat.lat);
          const lon = roundCoord(lngLat.lng);
          const alt = surface.threshold_position?.coordinates?.[2] ?? airport?.elevation ?? 0;
          setPickedThresholdCoord({ lat, lon, alt });
          setThresholdPickedMarker([lon, lat]);
          setPickingThreshold(false);
        }
        return true;
      }

      if (pickingEnd && selectedFeature?.type === "surface") {
        const surface = selectedFeature.data as { surface_type: string; end_position?: { coordinates: number[] } | null };
        if (surface.surface_type === "RUNWAY") {
          const lat = roundCoord(lngLat.lat);
          const lon = roundCoord(lngLat.lng);
          const alt = surface.end_position?.coordinates?.[2] ?? airport?.elevation ?? 0;
          setPickedEndCoord({ lat, lon, alt });
          setEndPickedMarker([lon, lat]);
          setPickingEnd(false);
        }
        return true;
      }

      if (pickingTouchpoint && selectedFeature?.type === "surface") {
        const surface = selectedFeature.data as { surface_type: string; touchpoint_altitude?: number | null };
        if (surface.surface_type === "RUNWAY") {
          const lat = roundCoord(lngLat.lat);
          const lon = roundCoord(lngLat.lng);
          const alt = surface.touchpoint_altitude ?? airport?.elevation ?? 0;
          setPickedTouchpointCoord({ lat, lon, alt });
          setTouchpointPickedMarker([lon, lat]);
          setPickingTouchpoint(false);
        }
        return true;
      }

      // pick touchpoint during creation mode (no selected feature)
      if (pickingTouchpoint && !selectedFeature) {
        const lat = roundCoord(lngLat.lat);
        const lon = roundCoord(lngLat.lng);
        const alt = airport?.elevation ?? 0;
        setPickedTouchpointCoord({ lat, lon, alt });
        setTouchpointPickedMarker([lon, lat]);
        setPickingTouchpoint(false);
        return true;
      }

      // pick threshold during creation mode (no selected feature)
      if (pickingThreshold && !selectedFeature) {
        const lat = roundCoord(lngLat.lat);
        const lon = roundCoord(lngLat.lng);
        const alt = airport?.elevation ?? 0;
        setPickedThresholdCoord({ lat, lon, alt });
        setThresholdPickedMarker([lon, lat]);
        setPickingThreshold(false);
        return true;
      }

      // pick end position during creation mode (no selected feature)
      if (pickingEnd && !selectedFeature) {
        const lat = roundCoord(lngLat.lat);
        const lon = roundCoord(lngLat.lng);
        const alt = airport?.elevation ?? 0;
        setPickedEndCoord({ lat, lon, alt });
        setEndPickedMarker([lon, lat]);
        setPickingEnd(false);
        return true;
      }

      return false;
    },
    [pickingTouchpoint, pickingLha, pickingThreshold, pickingEnd, selectedFeature, airport],
  );

  // cancel touchpoint/threshold/end picking when selection changes or panel closes
  useEffect(() => {
    if (!selectedFeature || selectedFeature.type !== "surface") {
      // don't cancel if creation form is open (no selected feature but pending geometry)
      if (pendingGeometry || pendingPointPosition) return;
      setPickingTouchpoint(false);
      setPickedTouchpointCoord(null);
      setTouchpointPickedMarker(null);
      setPickingThreshold(false);
      setPickedThresholdCoord(null);
      setThresholdPickedMarker(null);
      setPickingEnd(false);
      setPickedEndCoord(null);
      setEndPickedMarker(null);
    }
  }, [selectedFeature, pendingGeometry, pendingPointPosition]);

  // cancel touchpoint/threshold/end picking when creation form closes
  useEffect(() => {
    if (!pendingGeometry && !pendingPointPosition) {
      setPickingTouchpoint(false);
      setPickedTouchpointCoord(null);
      setTouchpointPickedMarker(null);
      setPickingThreshold(false);
      setPickedThresholdCoord(null);
      setThresholdPickedMarker(null);
      setPickingEnd(false);
      setPickedEndCoord(null);
      setEndPickedMarker(null);
    }
  }, [pendingGeometry, pendingPointPosition]);

  // cancel LHA picking when selection changes away from agl
  useEffect(() => {
    if (!selectedFeature || selectedFeature.type !== "agl") {
      setPickingLha(null);
      setPickedLhaCoord(null);
      setLhaPickedMarkers({ first: null, last: null });
    }
  }, [selectedFeature]);

  // render preview markers for picked first/last LHA positions and touchpoint
  useEffect(() => {
    const m = getMap();
    if (!m) return;
    const markers: maplibregl.Marker[] = [];

    function makeDot(color: string, title: string, pos: [number, number]) {
      /** create a small colored dot marker at the given position. */
      const el = document.createElement("div");
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.borderRadius = "50%";
      el.style.background = color;
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.4)";
      el.title = title;
      const marker = new maplibregl.Marker({ element: el }).setLngLat(pos).addTo(m as maplibregl.Map);
      markers.push(marker);
    }

    (["first", "last"] as const).forEach((which) => {
      const pos = lhaPickedMarkers[which];
      if (!pos) return;
      makeDot("var(--tv-accent)", which === "first" ? t("coordinator.detail.markers.firstLha") : t("coordinator.detail.markers.lastLha"), pos);
    });

    if (touchpointPickedMarker) {
      makeDot("#ffd166", t("coordinator.detail.markers.touchpoint"), touchpointPickedMarker);
    }

    if (thresholdPickedMarker) {
      makeDot("#4595e5", t("coordinator.detail.markers.threshold"), thresholdPickedMarker);
    }

    if (endPickedMarker) {
      makeDot("#e54545", t("coordinator.detail.markers.endPosition"), endPickedMarker);
    }

    return () => {
      markers.forEach((mk) => mk.remove());
    };
  }, [lhaPickedMarkers, touchpointPickedMarker, thresholdPickedMarker, endPickedMarker, getMap, t]);

  const anyPicking = pickingTouchpoint || !!pickingLha || pickingThreshold || pickingEnd;

  return {
    pickingTouchpoint,
    setPickingTouchpoint,
    pickedTouchpointCoord,
    setPickedTouchpointCoord,
    pickingLha,
    setPickingLha,
    pickedLhaCoord,
    setPickedLhaCoord,
    pickingThreshold,
    setPickingThreshold,
    pickedThresholdCoord,
    setPickedThresholdCoord,
    pickingEnd,
    setPickedEndCoord,
    setPickingEnd,
    pickedEndCoord,
    anyPicking,
    handlePickingMapClick,
  };
}
