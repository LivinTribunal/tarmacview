import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SurfaceResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { pairAwareSurfaceOrder } from "@/utils/surfacePairing";
import CollapsiblePanelHeader from "@/components/common/CollapsiblePanelHeader";
import { SurfaceListRow } from "./featureListRows";

interface GroundSurfacesPanelProps {
  surfaces: SurfaceResponse[];
  layerConfig: MapLayerConfig;
  // single-click: select only, no recenter
  onSelect: (feature: MapFeature) => void;
  // double-click: select AND recenter
  onLocate?: (feature: MapFeature) => void;
}

export default function GroundSurfacesPanel({
  surfaces,
  layerConfig,
  onSelect,
  onLocate,
}: GroundSurfacesPanelProps) {
  /** collapsible list of runways and taxiways. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const { surfaces: orderedSurfaces, pairPosition } = useMemo(
    () => pairAwareSurfaceOrder(surfaces),
    [surfaces],
  );
  const count = surfaces.length;

  function isGrayedOut(surface: SurfaceResponse): boolean {
    /** check if item should be grayed out based on layer visibility. */
    if (surface.surface_type === "RUNWAY") return !layerConfig.runways;
    if (surface.surface_type === "TAXIWAY") return !layerConfig.taxiways;
    return false;
  }

  function handleSelect(surface: SurfaceResponse) {
    /** single-click: select surface, no recenter. */
    if (isGrayedOut(surface)) return;
    onSelect({ type: "surface", data: surface });
  }

  function handleLocate(surface: SurfaceResponse) {
    /** double-click: select + recenter. */
    if (isGrayedOut(surface)) return;
    onLocate?.({ type: "surface", data: surface });
  }

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg"
      data-testid="ground-surfaces-panel"
    >
      <CollapsiblePanelHeader
        title={t("airport.groundSurfaces")}
        count={count}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />

      {!collapsed && (
        <div className="border-t border-tv-border max-h-60 overflow-y-auto">
          {count === 0 ? (
            <p className="px-3 py-3 text-sm italic text-tv-text-muted text-center">
              {t("airport.noSurfaces")}
            </p>
          ) : (
            orderedSurfaces.map((surface, idx) => {
              const grayed = isGrayedOut(surface);
              const partner = surface.paired_surface_id
                ? surfaces.find((p) => p.id === surface.paired_surface_id)
                : null;
              const pairPos = pairPosition.get(surface.id);
              return (
                <button
                  type="button"
                  key={surface.id}
                  onClick={() => handleSelect(surface)}
                  onDoubleClick={() => handleLocate(surface)}
                  className={`relative flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                    grayed
                      ? "opacity-50 pointer-events-none"
                      : "hover:bg-tv-surface-hover cursor-pointer"
                  } ${idx < count - 1 ? "border-b border-tv-border" : ""}`}
                  data-testid={`surface-item-${surface.id}`}
                >
                  <SurfaceListRow
                    surface={surface}
                    t={t}
                    partner={partner}
                    pairPosition={pairPos}
                  />
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
