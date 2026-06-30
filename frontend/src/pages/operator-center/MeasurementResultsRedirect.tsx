import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useAirport } from "@/contexts/AirportContext";
import { listAirportMeasurements } from "@/api/measurements";

/** resolves an old measurement deep-link to its owning mission's results tab. */
export default function MeasurementResultsRedirect() {
  const { measurementId } = useParams<{ measurementId: string }>();
  const { selectedAirport } = useAirport();
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!selectedAirport) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    listAirportMeasurements(selectedAirport.id)
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((r) => r.id === measurementId);
        setTarget(
          row
            ? `/operator-center/missions/${row.mission_id}/results?inspection=${row.inspection_id}`
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAirport, measurementId]);

  // still resolving the owning mission
  if (target === undefined) return null;

  return <Navigate to={target ?? "/operator-center/missions"} replace />;
}
