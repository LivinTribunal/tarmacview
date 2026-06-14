import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useParams } from "react-router";
import { useAirport } from "@/contexts/AirportContext";
import { getMission } from "@/api/missions";
import type { MissionDetailResponse } from "@/types/mission";

const DASHBOARD_PATH = "/operator-center/dashboard";

type FetchStatus = "idle" | "loading" | "match" | "mismatch" | "error";

export interface MissionRouteOutletContext {
  mission: MissionDetailResponse;
}

/** route guard that redirects when mission.airport_id mismatches selectedAirport. */
export default function RequireMissionAirportMatch() {
  const { id } = useParams<{ id: string }>();
  const { selectedAirport } = useAirport();
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [mission, setMission] = useState<MissionDetailResponse | null>(null);

  // reset to loading synchronously when the route id changes, so the previous
  // "match" verdict can't render the Outlet for one frame against the new id
  const prevIdRef = useRef(id);
  if (prevIdRef.current !== id) {
    prevIdRef.current = id;
    setStatus("loading");
    setMission(null);
  }

  useEffect(() => {
    if (!id || !selectedAirport) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    getMission(id)
      .then((m) => {
        if (cancelled) return;
        if (m.airport_id === selectedAirport.id) {
          setMission(m);
          setStatus("match");
        } else {
          setStatus("mismatch");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("mission airport guard fetch failed:", message);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, selectedAirport]);

  // belt-and-suspenders against an outer airport guard regressing
  if (!selectedAirport || !id) {
    return <Navigate to={DASHBOARD_PATH} replace />;
  }

  if (status === "loading" || status === "idle") {
    return null;
  }

  if (status === "mismatch" || status === "error" || !mission) {
    return <Navigate to={DASHBOARD_PATH} replace />;
  }

  return (
    <Outlet context={{ mission } satisfies MissionRouteOutletContext} />
  );
}
