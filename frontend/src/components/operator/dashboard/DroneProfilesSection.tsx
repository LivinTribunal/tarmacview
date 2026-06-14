import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Battery, Layers } from "lucide-react";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { MissionResponse } from "@/types/mission";
import Spinner from "./Spinner";

function DroneProfileRow({ dp, missionCount }: { dp: DroneProfileResponse; missionCount: number }) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-center p-3"
      data-testid={`drone-profile-${dp.id}`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-tv-text-primary">{dp.name}</p>
        <p className="text-xs text-tv-text-secondary">
          {[dp.manufacturer, dp.model].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-tv-text-primary">
          <Battery className="w-4 h-4" style={{ color: "var(--tv-accent)" }} />
          {dp.endurance_minutes != null ? `${dp.endurance_minutes} ${t("dashboard.minutes")}` : "—"}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-tv-text-primary">
          <Layers className="w-4 h-4" style={{ color: "var(--tv-info)" }} />
          {missionCount}
        </span>
      </div>
    </div>
  );
}

export default function DroneProfilesSection({
  profiles,
  loading,
  error,
  missions,
  defaultDroneProfileId,
}: {
  profiles: DroneProfileResponse[];
  loading: boolean;
  error: boolean;
  missions: MissionResponse[];
  defaultDroneProfileId?: string | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // count missions per drone profile
  const missionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of missions) {
      if (m.drone_profile_id) {
        counts[m.drone_profile_id] = (counts[m.drone_profile_id] || 0) + 1;
      }
    }
    return counts;
  }, [missions]);

  const mostUsedId = useMemo(() => {
    let topId: string | null = null;
    let topCount = 0;
    for (const [id, count] of Object.entries(missionCounts)) {
      if (count > topCount) {
        topId = id;
        topCount = count;
      }
    }
    return topId;
  }, [missionCounts]);

  const defaultDrone = defaultDroneProfileId
    ? profiles.find((dp) => dp.id === defaultDroneProfileId) ?? null
    : null;
  const mostUsed = profiles.find((dp) => dp.id === mostUsedId) ?? profiles[0] ?? null;
  const featured = defaultDrone ?? mostUsed;
  const featuredLabel = defaultDrone
    ? t("operatorDrones.defaultDrone")
    : t("dashboard.mostUsedDrone");
  const rest = profiles.filter((dp) => dp.id !== featured?.id);

  return (
    <div className="bg-tv-surface border border-tv-border rounded-3xl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 p-4 text-left"
        data-testid="section-dashboard.droneprofiles"
      >
        <div className="flex-1 flex items-center gap-2">
          <span className="text-base font-semibold text-tv-text-primary rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
            {t("dashboard.droneProfiles")}
          </span>
        </div>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-tv-text-secondary transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {loading ? (
        <div className="px-4 pb-4">
          <Spinner />
        </div>
      ) : error ? (
        <div className="px-4 pb-4">
          <p className="text-center text-xs text-tv-error py-4" data-testid="drone-profiles-error">
            {t("dashboard.droneLoadError")}
          </p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="px-4 pb-4">
          <p className="text-center text-xs text-tv-text-muted py-4">
            {t("dashboard.noDroneProfiles")}
          </p>
        </div>
      ) : (
        <>
          {featured && (
            <div className="border-t border-tv-border">
              <p className="px-3 pt-2 text-[10px] font-medium uppercase text-tv-text-muted">
                {featuredLabel}
              </p>
              <DroneProfileRow dp={featured} missionCount={missionCounts[featured.id] || 0} />
            </div>
          )}

          {/* expanded: all other drone profiles */}
          {expanded && (
            <div className="max-h-60 overflow-y-auto">
              {rest.map((dp) => (
                <div key={dp.id} className="border-t border-tv-border">
                  <DroneProfileRow dp={dp} missionCount={missionCounts[dp.id] || 0} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
