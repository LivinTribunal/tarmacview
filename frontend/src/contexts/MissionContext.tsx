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
import { useLocation, useNavigate } from "react-router";
import { useAirport } from "./AirportContext";
import { listMissions, getMission } from "@/api/missions";
import type { MissionResponse, MissionDetailResponse } from "@/types/mission";

const MISSION_KEY = "tarmacview_mission";

interface MissionContextValue {
  missions: MissionResponse[];
  missionsLoading: boolean;
  selectedMission: MissionDetailResponse | null;
  refreshMissions: () => Promise<void>;
  refreshSelectedMission: () => Promise<void>;
  updateMissionInList: (updated: MissionResponse) => void;
  setSelectedMission: (mission: MissionDetailResponse | null) => void;
  clearMission: () => void;
}

const MissionContext = createContext<MissionContextValue | null>(null);

/** provider for mission state with persistence and airport-change handling. */
export function MissionProvider({ children }: { children: ReactNode }) {
  const { selectedAirport } = useAirport();
  const navigate = useNavigate();
  const location = useLocation();

  const [missions, setMissions] = useState<MissionResponse[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [selectedMission, setSelectedMissionState] =
    useState<MissionDetailResponse | null>(null);

  const prevAirportIdRef = useRef<string | undefined>(selectedAirport?.id);
  const initialMountRef = useRef(true);
  const pathnameRef = useRef(location.pathname);

  // persist selected mission id to localStorage
  const setSelectedMission = useCallback(
    (mission: MissionDetailResponse | null) => {
      setSelectedMissionState(mission);
      if (mission) {
        localStorage.setItem(MISSION_KEY, mission.id);
      } else {
        localStorage.removeItem(MISSION_KEY);
      }
    },
    [],
  );

  const clearMission = useCallback(() => {
    setSelectedMissionState(null);
    localStorage.removeItem(MISSION_KEY);
  }, []);

  // fetch missions for the current airport
  const refreshMissions = useCallback(async () => {
    if (!selectedAirport) {
      setMissions([]);
      return;
    }
    setMissionsLoading(true);
    try {
      const res = await listMissions({
        airport_id: selectedAirport.id,
        limit: 100,
      });
      setMissions(res.data);
    } catch {
      // ignore - keep stale list
    } finally {
      setMissionsLoading(false);
    }
  }, [selectedAirport]);

  // re-fetch the selected mission detail from server
  const refreshSelectedMission = useCallback(async () => {
    if (!selectedMission) return;
    try {
      const fresh = await getMission(selectedMission.id);
      setSelectedMissionState(fresh);
    } catch {
      // ignore
    }
  }, [selectedMission]);

  // optimistically update a mission in the list without full refetch
  const updateMissionInList = useCallback((updated: MissionResponse) => {
    setMissions((prev) =>
      prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
    );
    // also update selectedMission status if it matches
    setSelectedMissionState((prev) => {
      if (!prev || prev.id !== updated.id) return prev;
      return { ...prev, ...updated };
    });
  }, []);

  // fetch missions when airport changes
  useEffect(() => {
    refreshMissions();
  }, [refreshMissions]);

  // keep pathname ref in sync for airport-change effect
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  // when airport changes (not initial mount), clear mission and redirect
  useEffect(() => {
    const prevId = prevAirportIdRef.current;
    const newId = selectedAirport?.id;
    prevAirportIdRef.current = newId;

    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }

    if (prevId && prevId !== newId) {
      clearMission();
      if (pathnameRef.current.includes("/missions/")) {
        navigate("/operator-center/dashboard", { replace: true });
      }
    }
  }, [selectedAirport?.id, clearMission, navigate]);

  // rehydrate the selected mission from localStorage once an airport is set.
  // the route guard ensures airport is selected before any /missions/* route
  // renders - if it disagrees with the saved mission's airport, drop the key.
  const rehydratedRef = useRef(false);
  useEffect(() => {
    if (rehydratedRef.current || !selectedAirport) return;
    const savedId = localStorage.getItem(MISSION_KEY);
    if (!savedId) return;
    rehydratedRef.current = true;

    getMission(savedId)
      .then((mission) => {
        if (mission.airport_id === selectedAirport.id) {
          setSelectedMissionState(mission);
        } else {
          localStorage.removeItem(MISSION_KEY);
        }
      })
      .catch(() => {
        rehydratedRef.current = false;
        localStorage.removeItem(MISSION_KEY);
      });
  }, [selectedAirport]);

  const value = useMemo<MissionContextValue>(
    () => ({
      missions,
      missionsLoading,
      selectedMission,
      refreshMissions,
      refreshSelectedMission,
      updateMissionInList,
      setSelectedMission,
      clearMission,
    }),
    [
      missions,
      missionsLoading,
      selectedMission,
      refreshMissions,
      refreshSelectedMission,
      updateMissionInList,
      setSelectedMission,
      clearMission,
    ],
  );

  return (
    <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
  );
}

/** read the mission context - must be used within MissionProvider. */
export function useMission(): MissionContextValue {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    throw new Error("useMission must be used within MissionProvider");
  }
  return ctx;
}
