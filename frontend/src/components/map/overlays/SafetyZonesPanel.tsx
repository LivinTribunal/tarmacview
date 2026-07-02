import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SafetyZoneResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { NEUTRAL } from "@/constants/palette";
import CollapsiblePanelHeader from "@/components/common/CollapsiblePanelHeader";
import { SafetyZoneListRow } from "./featureListRows";

interface SafetyZonesPanelProps {
  safetyZones: SafetyZoneResponse[];
  layerConfig: MapLayerConfig;
  // single-click: select only, no recenter
  onSelect: (feature: MapFeature) => void;
  // double-click: select AND recenter
  onLocate?: (feature: MapFeature) => void;
}

export default function SafetyZonesPanel({
  safetyZones,
  layerConfig,
  onSelect,
  onLocate,
}: SafetyZonesPanelProps) {
  /** collapsible list of safety zones with color-coded indicators. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const boundaryZone = safetyZones.find((z) => z.type === "AIRPORT_BOUNDARY");
  const regularZones = safetyZones.filter((z) => z.type !== "AIRPORT_BOUNDARY");
  const count = regularZones.length;
  const zonesGrayed = !layerConfig.safetyZones;
  const boundaryGrayed = !layerConfig.airportBoundary;

  function handleSelectZone(zone: SafetyZoneResponse) {
    /** single-click on a regular zone: select without recentering. */
    if (zonesGrayed) return;
    onSelect({ type: "safety_zone", data: zone });
  }

  function handleLocateZone(zone: SafetyZoneResponse) {
    /** double-click on a regular zone: select and recenter. */
    if (zonesGrayed) return;
    onLocate?.({ type: "safety_zone", data: zone });
  }

  function handleSelectBoundary(zone: SafetyZoneResponse) {
    /** single-click on the boundary row: select without recentering. */
    if (boundaryGrayed) return;
    onSelect({ type: "safety_zone", data: zone });
  }

  function handleLocateBoundary(zone: SafetyZoneResponse) {
    /** double-click on the boundary row: select and recenter. */
    if (boundaryGrayed) return;
    onLocate?.({ type: "safety_zone", data: zone });
  }

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg"
      data-testid="safety-zones-panel"
    >
      <CollapsiblePanelHeader
        title={t("layers.safetyZonesAndBoundary")}
        count={count}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />

      {!collapsed && (
        <div className="border-t border-tv-border max-h-60 overflow-y-auto">
          {boundaryZone ? (
            <button
              type="button"
              onClick={() => handleSelectBoundary(boundaryZone)}
              onDoubleClick={() => handleLocateBoundary(boundaryZone)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors border-b border-tv-border ${
                boundaryGrayed ? "opacity-50 pointer-events-none" : "hover:bg-tv-surface-hover cursor-pointer"
              }`}
              data-testid={`boundary-item-${boundaryZone.id}`}
            >
              <svg className="h-2.5 w-2.5 flex-shrink-0" viewBox="0 0 10 10">
                <rect
                  x="0.5" y="0.5" width="9" height="9" rx="1"
                  fill="none" stroke={NEUTRAL.WHITE} strokeWidth="1.2" strokeDasharray="2.5 1.5"
                />
              </svg>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-xs font-medium text-tv-text-primary truncate">
                  {boundaryZone.name}
                </span>
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border border-tv-border text-tv-text-secondary"
                >
                  {t("boundary.airportBoundary")}
                </span>
              </div>
            </button>
          ) : (
            <div
              className="px-3 py-2 text-xs italic text-tv-text-muted border-b border-tv-border"
              data-testid="boundary-item-empty"
            >
              {t("boundary.noBoundary")}
            </div>
          )}
          {count === 0 ? (
            <p className="px-3 py-3 text-sm italic text-tv-text-muted text-center">
              {t("airport.noSafetyZones")}
            </p>
          ) : (
            regularZones.map((zone, idx) => (
              <button
                type="button"
                key={zone.id}
                onClick={() => handleSelectZone(zone)}
                onDoubleClick={() => handleLocateZone(zone)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  zonesGrayed
                    ? "opacity-50 pointer-events-none"
                    : "hover:bg-tv-surface-hover cursor-pointer"
                } ${idx < count - 1 ? "border-b border-tv-border" : ""}`}
                data-testid={`zone-item-${zone.id}`}
              >
                <SafetyZoneListRow zone={zone} t={t} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
