import { useEffect, useState } from "react";

import {
  createObstacle,
  createSafetyZone,
  createSurface,
  lookupAirport,
} from "@/api/airports";
import { isAxiosError } from "@/api/client";
import type {
  AirportLookupResponse,
  ObstacleSuggestion,
  RunwaySuggestion,
  SafetyZoneSuggestion,
} from "@/types/airport";

export const ICAO_REGEX = /^[A-Z]{4}$/;

// bounds (km) the openaip data import radius is clamped to
export const MIN_IMPORT_RADIUS_KM = 0.5;
export const MAX_IMPORT_RADIUS_KM = 50;

export interface SuggestionState {
  runways: Array<RunwaySuggestion & { checked: boolean }>;
  obstacles: Array<ObstacleSuggestion & { checked: boolean }>;
  safetyZones: Array<SafetyZoneSuggestion & { checked: boolean }>;
}

interface UseAirportLookupParams {
  isOpen: boolean;
  icaoCode: string;
  importRadius: string;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  setName: (v: string) => void;
  setCity: (v: string) => void;
  setCountry: (v: string) => void;
  setLat: (v: string) => void;
  setLon: (v: string) => void;
  setAlt: (v: string) => void;
}

interface AirportLookupReturn {
  suggestions: SuggestionState | null;
  looking: boolean;
  lookupError: string | null;
  lookupEmpty: boolean;
  expanded: { runways: boolean; safetyZones: boolean; obstacles: boolean };
  applyLookup: (data: AirportLookupResponse) => void;
  handleLookup: () => Promise<void>;
  toggleSection: (key: "runways" | "safetyZones" | "obstacles") => void;
  toggleRunway: (index: number) => void;
  toggleObstacle: (index: number) => void;
  toggleSafetyZone: (index: number) => void;
  setSectionChecked: (
    key: "runways" | "obstacles" | "safetyZones",
    checked: boolean,
  ) => void;
  setAllChecked: (checked: boolean) => void;
  createCheckedSuggestions: (airportId: string) => Promise<number>;
}

/** owns the openaip lookup + suggestion checkbox state machine for the create-airport dialog. */
export default function useAirportLookup({
  isOpen,
  icaoCode,
  importRadius,
  setErrors,
  t,
  setName,
  setCity,
  setCountry,
  setLat,
  setLon,
  setAlt,
}: UseAirportLookupParams): AirportLookupReturn {
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupEmpty, setLookupEmpty] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionState | null>(null);
  const [expanded, setExpanded] = useState<{
    runways: boolean;
    safetyZones: boolean;
    obstacles: boolean;
  }>({
    runways: true,
    safetyZones: true,
    obstacles: true,
  });

  useEffect(() => {
    // clear lookup + suggestion state when the dialog reopens
    if (isOpen) {
      setLookupError(null);
      setLookupEmpty(false);
      setSuggestions(null);
    }
  }, [isOpen]);

  function toggleSection(key: "runways" | "safetyZones" | "obstacles") {
    /** toggle expanded state for a suggestion section. */
    setExpanded((s) => ({ ...s, [key]: !s[key] }));
  }

  function applyLookup(data: AirportLookupResponse) {
    /** fill the form from a successful lookup response. */
    setName(data.name || "");
    setCity(data.city || "");
    setCountry(data.country || "");
    const [lonVal, latVal, altVal] = data.location.coordinates;
    setLat(latVal.toFixed(6));
    setLon(lonVal.toFixed(6));
    setAlt((altVal ?? data.elevation ?? 0).toFixed(1));
    setSuggestions({
      runways: data.runways.map((r) => ({ ...r, checked: true })),
      obstacles: data.obstacles.map((o) => ({ ...o, checked: true })),
      safetyZones: data.safety_zones.map((z) => ({ ...z, checked: true })),
    });
    setLookupEmpty(
      data.runways.length === 0 &&
        data.obstacles.length === 0 &&
        data.safety_zones.length === 0,
    );
  }

  async function handleLookup() {
    /** call openaip lookup and fill form with the result. */
    if (!ICAO_REGEX.test(icaoCode)) {
      setErrors({ icaoCode: t("coordinator.createAirport.icaoRequired") });
      return;
    }

    const radius = parseFloat(importRadius);
    if (
      !isNaN(radius) &&
      (radius < MIN_IMPORT_RADIUS_KM || radius > MAX_IMPORT_RADIUS_KM)
    ) {
      setErrors({ importRadius: t("coordinator.createAirport.importRadiusInvalid") });
      return;
    }

    setLooking(true);
    setLookupError(null);
    setLookupEmpty(false);
    setSuggestions(null);
    try {
      const result = await lookupAirport(
        icaoCode,
        !isNaN(radius) && radius > 0 ? radius : undefined,
      );
      applyLookup(result);
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 404) {
          setLookupError(t("coordinator.createAirport.lookup.notFound"));
        } else if (status === 503) {
          setLookupError(t("coordinator.createAirport.lookup.noApiKey"));
        } else {
          setLookupError(t("coordinator.createAirport.lookup.apiDown"));
        }
      } else {
        setLookupError(t("coordinator.createAirport.lookup.apiDown"));
      }
    } finally {
      setLooking(false);
    }
  }

  function toggleRunway(index: number) {
    /** toggle checked state for a runway suggestion. */
    setSuggestions((s) =>
      s
        ? {
            ...s,
            runways: s.runways.map((r, i) =>
              i === index ? { ...r, checked: !r.checked } : r,
            ),
          }
        : s,
    );
  }

  function toggleObstacle(index: number) {
    /** toggle checked state for an obstacle suggestion. */
    setSuggestions((s) =>
      s
        ? {
            ...s,
            obstacles: s.obstacles.map((o, i) =>
              i === index ? { ...o, checked: !o.checked } : o,
            ),
          }
        : s,
    );
  }

  function setSectionChecked(
    key: "runways" | "obstacles" | "safetyZones",
    checked: boolean,
  ) {
    /** set checked state on every item in a section. */
    setSuggestions((s) =>
      s
        ? {
            ...s,
            [key]: s[key].map((item) => ({ ...item, checked })),
          }
        : s,
    );
  }

  function setAllChecked(checked: boolean) {
    /** set checked state on every suggestion across all sections. */
    setSuggestions((s) =>
      s
        ? {
            runways: s.runways.map((r) => ({ ...r, checked })),
            obstacles: s.obstacles.map((o) => ({ ...o, checked })),
            safetyZones: s.safetyZones.map((z) => ({ ...z, checked })),
          }
        : s,
    );
  }

  function toggleSafetyZone(index: number) {
    /** toggle checked state for a safety zone suggestion. */
    setSuggestions((s) =>
      s
        ? {
            ...s,
            safetyZones: s.safetyZones.map((z, i) =>
              i === index ? { ...z, checked: !z.checked } : z,
            ),
          }
        : s,
    );
  }

  async function createCheckedSuggestions(airportId: string): Promise<number> {
    /** create surfaces / obstacles / safety zones; return count of failures. */
    if (!suggestions) return 0;

    const trackFailure = (err: unknown) => {
      console.warn("failed to create suggested item", err);
      return null;
    };

    const runwayPromises = suggestions.runways.flatMap((r) =>
      r.checked
        ? [
            createSurface(airportId, {
              identifier: r.identifier,
              surface_type: "RUNWAY",
              geometry: r.geometry,
              boundary: r.boundary,
              heading: r.heading,
              length: r.length,
              width: r.width,
              threshold_position: r.threshold_position,
              end_position: r.end_position,
            }).catch(trackFailure),
          ]
        : [],
    );
    const obstaclePromises = suggestions.obstacles.flatMap((o) =>
      o.checked
        ? [
            createObstacle(airportId, {
              name: o.name,
              type: o.type,
              height: o.height,
              boundary: o.boundary,
            }).catch(trackFailure),
          ]
        : [],
    );
    const zonePromises = suggestions.safetyZones.flatMap((z) =>
      z.checked
        ? [
            createSafetyZone(airportId, {
              name: z.name,
              type: z.type,
              geometry: z.geometry,
              altitude_floor: z.altitude_floor,
              altitude_ceiling: z.altitude_ceiling,
              is_active: true,
            }).catch(trackFailure),
          ]
        : [],
    );

    const results = await Promise.all([
      ...runwayPromises,
      ...obstaclePromises,
      ...zonePromises,
    ]);
    return results.filter((r) => r === null).length;
  }

  return {
    suggestions,
    looking,
    lookupError,
    lookupEmpty,
    expanded,
    applyLookup,
    handleLookup,
    toggleSection,
    toggleRunway,
    toggleObstacle,
    toggleSafetyZone,
    setSectionChecked,
    setAllChecked,
    createCheckedSuggestions,
  };
}
