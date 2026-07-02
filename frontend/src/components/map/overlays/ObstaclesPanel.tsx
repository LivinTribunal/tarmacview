import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObstacleResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import CollapsiblePanelHeader from "@/components/common/CollapsiblePanelHeader";
import { ObstacleListRow } from "./featureListRows";

interface ObstaclesPanelProps {
  obstacles: ObstacleResponse[];
  layerConfig: MapLayerConfig;
  // single-click: select the obstacle, no map recenter
  onSelect: (feature: MapFeature) => void;
  // double-click: select AND recenter the map on the obstacle
  onLocate?: (feature: MapFeature) => void;
}

export default function ObstaclesPanel({
  obstacles,
  layerConfig,
  onSelect,
  onLocate,
}: ObstaclesPanelProps) {
  /** collapsible list of airport obstacles. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const count = obstacles.length;
  const grayed = !layerConfig.obstacles;

  function handleSelect(obstacle: ObstacleResponse) {
    /** single-click: select obstacle without moving the camera. */
    if (grayed) return;
    onSelect({ type: "obstacle", data: obstacle });
  }

  function handleLocate(obstacle: ObstacleResponse) {
    /** double-click: select obstacle and recenter the map on it. */
    if (grayed) return;
    onLocate?.({ type: "obstacle", data: obstacle });
  }

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg"
      data-testid="obstacles-panel"
    >
      <CollapsiblePanelHeader
        title={t("airport.obstacles")}
        count={count}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />

      {!collapsed && (
        <div className="border-t border-tv-border max-h-60 overflow-y-auto">
          {count === 0 ? (
            <p className="px-3 py-3 text-sm italic text-tv-text-muted text-center">
              {t("airport.noObstacles")}
            </p>
          ) : (
            obstacles.map((obstacle, idx) => (
              <button
                type="button"
                key={obstacle.id}
                onClick={() => handleSelect(obstacle)}
                onDoubleClick={() => handleLocate(obstacle)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  grayed
                    ? "opacity-50 pointer-events-none"
                    : "hover:bg-tv-surface-hover cursor-pointer"
                } ${idx < count - 1 ? "border-b border-tv-border" : ""}`}
                data-testid={`obstacle-item-${obstacle.id}`}
              >
                <ObstacleListRow obstacle={obstacle} t={t} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
