import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MissionStatus } from "@/types/enums";
import type { MapLayerConfig } from "@/types/map";
import { AglSystemsSection } from "./legend/AglSystemsSection";
import { LegendSection } from "./legend/LegendSection";
import {
  STATUSES_WITH_FULL_WAYPOINTS,
  allWaypointItems,
  obstacleItems,
  surfaceItems,
  takeoffLandingItems,
  zoneItems,
} from "./legend/legendEntries";

interface LegendPanelProps {
  missionStatus?: MissionStatus;
  hasTakeoff?: boolean;
  hasLanding?: boolean;
  layers?: MapLayerConfig;
  className?: string;
}

export default function LegendPanel({
  missionStatus,
  hasTakeoff,
  hasLanding,
  layers,
  className,
}: LegendPanelProps) {
  /** map legend panel with aviation-chart symbology sections. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const hasFullWaypoints =
    missionStatus !== undefined && STATUSES_WITH_FULL_WAYPOINTS.includes(missionStatus);
  const hasTakeoffLanding = hasTakeoff || hasLanding;

  const showSurfaces = !layers || layers.runways || layers.taxiways;
  const showZones = !layers || layers.safetyZones || layers.airportBoundary;
  const showObstacles = !layers || layers.obstacles;
  const showFeatures = !layers || layers.aglSystems;
  const showWaypoints = !layers || layers.trajectory;

  return (
    <div
      className={className ?? "absolute top-3 right-3 z-10 w-44 rounded-2xl border border-tv-border bg-tv-bg"}
      style={className ? undefined : { maxHeight: "calc(100% - 170px)" }}
      data-testid="legend-panel"
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-surface border border-tv-border">
          {t("dashboard.legend")}
        </span>
        <svg
          className={`ml-2 h-4 w-4 text-tv-text-secondary transition-transform ${collapsed ? "" : "rotate-180"}`}
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
      {!collapsed && (
        <div className="border-t border-tv-border px-3 pb-2 pt-1 space-y-2 overflow-y-auto max-h-[40vh]">
          {showSurfaces && (
            <LegendSection
              title={t("dashboard.groundSurfaces")}
              items={surfaceItems}
              defaultOpen={false}
            />
          )}
          {showZones && (
            <LegendSection
              title={t("layers.safetyZonesAndBoundary")}
              items={zoneItems}
              defaultOpen={false}
            />
          )}
          {showObstacles && (
            <LegendSection
              title={t("dashboard.obstacles")}
              items={obstacleItems}
            />
          )}
          {showFeatures && <AglSystemsSection />}
          {showWaypoints && hasFullWaypoints ? (
            <LegendSection
              title={t("dashboard.flightPlan")}
              items={allWaypointItems}
            />
          ) : showWaypoints && hasTakeoffLanding ? (
            <LegendSection
              title={t("dashboard.flightPlan")}
              items={takeoffLandingItems}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
