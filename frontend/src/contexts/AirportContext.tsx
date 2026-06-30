import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { AirportResponse, AirportDetailResponse } from "@/types/airport";
import { getAirport } from "@/api/airports";

const AIRPORT_KEY = "tarmacview_airport";

/** synchronously hydrate selectedAirport from localStorage on first render. */
function readAirportFromStorage(): AirportResponse | null {
  const saved = localStorage.getItem(AIRPORT_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (
      typeof parsed?.id === "string" &&
      typeof parsed?.icao_code === "string" &&
      typeof parsed?.name === "string" &&
      typeof parsed?.elevation === "number" &&
      parsed.location &&
      typeof parsed.location === "object" &&
      Array.isArray(parsed.location.coordinates) &&
      parsed.location.coordinates.length >= 2
    ) {
      return parsed as AirportResponse;
    }
  } catch {
    // fall through to cleanup
  }
  localStorage.removeItem(AIRPORT_KEY);
  return null;
}

interface AirportContextValue {
  selectedAirport: AirportResponse | null;
  airportDetail: AirportDetailResponse | null;
  airportDetailLoading: boolean;
  airportDetailError: boolean;
  selectAirport: (airport: AirportResponse) => void;
  clearAirport: () => void;
  refreshAirportDetail: () => void;
}

const AirportContext = createContext<AirportContextValue | null>(null);

/** provider for the active airport and its lazily-fetched detail. */
export function AirportProvider({ children }: { children: ReactNode }) {
  // hydrate synchronously so the first render reflects localStorage. routes
  // that gate on selectedAirport must not see a transient null on reload.
  const [selectedAirport, setSelectedAirport] = useState<AirportResponse | null>(
    readAirportFromStorage,
  );
  const [airportDetail, setAirportDetail] =
    useState<AirportDetailResponse | null>(null);
  const [airportDetailLoading, setAirportDetailLoading] = useState(false);
  const [airportDetailError, setAirportDetailError] = useState(false);
  const fetchCounterRef = useRef(0);
  const hasHydrated = useRef(false);

  const fetchDetail = useCallback((airportId: string) => {
    const requestId = ++fetchCounterRef.current;
    setAirportDetailLoading(true);
    setAirportDetailError(false);
    getAirport(airportId)
      .then((detail) => {
        if (fetchCounterRef.current !== requestId) return;
        setAirportDetail(detail);
        setSelectedAirport((prev) => {
          // deep-linked nav may arrive with no selected airport - hydrate from detail
          if (!prev || prev.id !== detail.id) {
            const summary: AirportResponse = {
              id: detail.id,
              icao_code: detail.icao_code,
              name: detail.name,
              city: detail.city,
              country: detail.country,
              elevation: detail.elevation,
              location: detail.location,
              default_drone_profile_id: detail.default_drone_profile_id,
              terrain_source: detail.terrain_source,
              has_dem: detail.has_dem,
            };
            return summary;
          }
          if (prev.default_drone_profile_id === detail.default_drone_profile_id) return prev;
          return { ...prev, default_drone_profile_id: detail.default_drone_profile_id };
        });
        setAirportDetailError(false);
      })
      .catch(() => {
        if (fetchCounterRef.current !== requestId) return;
        setAirportDetail(null);
        setAirportDetailError(true);
      })
      .finally(() => {
        if (fetchCounterRef.current !== requestId) return;
        setAirportDetailLoading(false);
      });
  }, []);

  // persist selected airport to localStorage
  useEffect(() => {
    if (!hasHydrated.current) return;
    if (selectedAirport) {
      localStorage.setItem(AIRPORT_KEY, JSON.stringify(selectedAirport));
    } else {
      localStorage.removeItem(AIRPORT_KEY);
    }
  }, [selectedAirport]);

  // mark hydration complete so the persist effect skips the initial render.
  useEffect(() => {
    hasHydrated.current = true;
  }, []);

  // selectedAirport is hydrated synchronously above; this only kicks off the
  // async detail fetch on mount. selectAirport handles subsequent changes.
  // fetchDetail is stable (useCallback with []) so omitting it from deps is safe.
  useEffect(() => {
    if (selectedAirport) {
      fetchDetail(selectedAirport.id);
    }
  }, []);

  const selectAirport = useCallback(
    (airport: AirportResponse) => {
      setSelectedAirport(airport);
      setAirportDetail(null);
      setAirportDetailError(false);
      fetchDetail(airport.id);
    },
    [fetchDetail],
  );

  const clearAirport = useCallback(() => {
    setSelectedAirport(null);
    setAirportDetail(null);
    setAirportDetailError(false);
  }, []);

  const refreshAirportDetail = useCallback(() => {
    if (selectedAirport) {
      fetchDetail(selectedAirport.id);
    }
  }, [selectedAirport, fetchDetail]);

  const value = useMemo<AirportContextValue>(
    () => ({
      selectedAirport,
      airportDetail,
      airportDetailLoading,
      airportDetailError,
      selectAirport,
      clearAirport,
      refreshAirportDetail,
    }),
    [
      selectedAirport,
      airportDetail,
      airportDetailLoading,
      airportDetailError,
      selectAirport,
      clearAirport,
      refreshAirportDetail,
    ],
  );

  return (
    <AirportContext.Provider value={value}>{children}</AirportContext.Provider>
  );
}

/** read the airport context - must be used within AirportProvider. */
export function useAirport(): AirportContextValue {
  const ctx = useContext(AirportContext);
  if (!ctx) {
    throw new Error("useAirport must be used within AirportProvider");
  }
  return ctx;
}
