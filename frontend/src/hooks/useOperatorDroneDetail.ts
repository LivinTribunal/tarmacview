import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDroneProfile,
  listDroneProfiles,
} from "@/api/droneProfiles";
import { listMissions } from "@/api/missions";
import { setDefaultDrone } from "@/api/airports";
import { useAirport } from "@/contexts/AirportContext";
import { MAX_LIST_LIMIT } from "@/constants/pagination";
import { NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";
import { resolveModelUrl } from "@/hooks/useDroneProfileList";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { MissionResponse } from "@/types/mission";

interface UseOperatorDroneDetailOptions {
  id: string | undefined;
}

interface UseOperatorDroneDetailResult {
  drone: DroneProfileResponse | null;
  allDrones: DroneProfileResponse[];
  missions: MissionResponse[];
  loading: boolean;
  error: boolean;
  defaultDroneId: string | null | undefined;
  isDefault: boolean;
  totalDuration: number;
  modelUrl: string | null;
  fetchDrone: () => void;
  toggleDefault: () => Promise<boolean>;
  notification: string;
  showToast: (msg: string) => void;
}

/** data + side-effect orchestration for the read-only operator drone detail page. */
export default function useOperatorDroneDetail({
  id,
}: UseOperatorDroneDetailOptions): UseOperatorDroneDetailResult {
  const { selectedAirport, refreshAirportDetail } = useAirport();

  const [drone, setDrone] = useState<DroneProfileResponse | null>(null);
  const [allDrones, setAllDrones] = useState<DroneProfileResponse[]>([]);
  const [missions, setMissions] = useState<MissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [notification, setNotification] = useState("");
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultDroneId = selectedAirport?.default_drone_profile_id;
  const isDefault = defaultDroneId === id;

  const totalDuration = useMemo(
    () => missions.reduce((sum, m) => sum + (m.estimated_duration ?? 0), 0),
    [missions],
  );

  const modelUrl = useMemo(
    () => resolveModelUrl(drone?.model_identifier ?? null),
    [drone],
  );

  const fetchDrone = useCallback(() => {
    /** fetch drone profile, all drones, and missions using this drone. */
    if (!id) return;
    setLoading(true);
    setError(false);
    Promise.all([
      getDroneProfile(id),
      listDroneProfiles({ limit: MAX_LIST_LIMIT }),
      listMissions({
        drone_profile_id: id,
        airport_id: selectedAirport?.id,
        limit: MAX_LIST_LIMIT,
      }),
    ])
      .then(([droneData, listData, missionsData]) => {
        setDrone(droneData);
        setAllDrones(listData.data);
        setMissions(missionsData.data);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id, selectedAirport?.id]);

  useEffect(() => {
    fetchDrone();
  }, [fetchDrone]);

  useEffect(() => {
    return () => {
      if (notificationTimer.current) clearTimeout(notificationTimer.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    setNotification(msg);
    notificationTimer.current = setTimeout(
      () => setNotification(""),
      NOTIFICATION_TIMEOUT_MS,
    );
  }, []);

  const toggleDefault = useCallback(async () => {
    /** toggle default drone for this airport; returns true on success. */
    if (!selectedAirport || !id) return false;
    try {
      await setDefaultDrone(selectedAirport.id, isDefault ? null : id);
      await refreshAirportDetail();
      return true;
    } catch (err) {
      console.error(
        "toggle default failed:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }, [selectedAirport, id, isDefault, refreshAirportDetail]);

  return {
    drone,
    allDrones,
    missions,
    loading,
    error,
    defaultDroneId,
    isDefault,
    totalDuration,
    modelUrl,
    fetchDrone,
    toggleDefault,
    notification,
    showToast,
  };
}
