import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { formatAglDisplayName } from "@/utils/agl";
import { aglColorForType } from "@/utils/aglColor";
import { formatNumber } from "@/utils/format";
import { formatLat, formatLon } from "@/utils/coordinates";
import CopyableValue from "@/components/common/CopyableValue";
import CollapsiblePanelHeader from "@/components/common/CollapsiblePanelHeader";

interface AGLPanelProps {
  surfaces: SurfaceResponse[];
  layerConfig: MapLayerConfig;
  // single-click: select only, no recenter
  onSelect: (feature: MapFeature) => void;
  // double-click: select AND recenter
  onLocate?: (feature: MapFeature) => void;
}

export default function AGLPanel({
  surfaces,
  layerConfig,
  onSelect,
  onLocate,
}: AGLPanelProps) {
  /** collapsible list of agl systems with expandable lha sub-items. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAgls, setExpandedAgls] = useState<Set<string>>(new Set());

  const allAgls = surfaces.flatMap((s) => s.agls);
  const count = allAgls.length;
  const grayed = !layerConfig.aglSystems;

  const aglDisplayNames = useMemo(() => {
    /** pre-compute display names keyed by agl id. */
    const map = new Map<string, string>();
    for (const s of surfaces) {
      for (const agl of s.agls) {
        map.set(agl.id, formatAglDisplayName(agl, s));
      }
    }
    return map;
  }, [surfaces]);

  function toggleExpand(aglId: string) {
    /** toggle expand/collapse state for an agl item. */
    setExpandedAgls((prev) => {
      const next = new Set(prev);
      if (next.has(aglId)) {
        next.delete(aglId);
      } else {
        next.add(aglId);
      }
      return next;
    });
  }

  function handleAglSelect(agl: AGLResponse) {
    /** single-click: select agl, no recenter. */
    if (grayed) return;
    onSelect({ type: "agl", data: agl });
  }

  function handleAglLocate(agl: AGLResponse) {
    /** double-click: select + recenter. */
    if (grayed) return;
    onLocate?.({ type: "agl", data: agl });
  }

  function handleLhaSelect(lha: LHAResponse, e: React.MouseEvent) {
    /** single-click: select lha, no recenter. */
    e.stopPropagation();
    // browser fires two click events before dblclick on a double-click;
    // bail on the second so onSelect doesn't fire twice
    if (e.detail > 1) return;
    if (grayed) return;
    onSelect({ type: "lha", data: lha });
  }

  function handleLhaLocate(lha: LHAResponse, e: React.MouseEvent) {
    /** double-click: select + recenter. */
    e.stopPropagation();
    if (grayed) return;
    onLocate?.({ type: "lha", data: lha });
  }

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg"
      data-testid="agl-panel"
    >
      <CollapsiblePanelHeader
        title={t("airport.aglSystems")}
        count={count}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />

      {!collapsed && (
        <div className="border-t border-tv-border max-h-60 overflow-y-auto">
          {count === 0 ? (
            <p className="px-3 py-3 text-sm italic text-tv-text-muted text-center">
              {t("airport.noAglSystems")}
            </p>
          ) : (
            allAgls.map((agl, idx) => {
              const expanded = expandedAgls.has(agl.id);
              const aglColor = aglColorForType(agl.agl_type);
              return (
                <div
                  key={agl.id}
                  className={idx < count - 1 ? "border-b border-tv-border" : ""}
                >
                  <button
                    onClick={(e) => {
                      // browser fires two click events before dblclick on a double-click;
                      // bail on the second so the accordion doesn't toggle back closed
                      if (e.detail > 1) return;
                      handleAglSelect(agl);
                      toggleExpand(agl.id);
                    }}
                    onDoubleClick={() => handleAglLocate(agl)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                      grayed
                        ? "opacity-50 pointer-events-none"
                        : "hover:bg-tv-surface-hover cursor-pointer"
                    }`}
                    data-testid={`agl-item-${agl.id}`}
                  >
                    {/* type-colored circle icon */}
                    <span
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: aglColor }}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-tv-text-primary truncate">
                          {aglDisplayNames.get(agl.id) ?? agl.name}
                        </span>
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                          style={{ borderColor: aglColor, color: aglColor }}
                        >
                          {agl.agl_type === "RUNWAY_EDGE_LIGHTS" ? "REL" : agl.agl_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-tv-text-secondary">
                          {agl.lhas.length} {t("airport.units")}
                        </span>
                      </div>
                    </div>

                    {agl.lhas.length > 0 && (
                      <ChevronDown className={`h-3 w-3 text-tv-text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
                    )}
                  </button>

                  {/* lha sub-items */}
                  {expanded && agl.lhas.length > 0 && (
                    <div className="bg-tv-bg">
                      {agl.lhas.map((lha, lhaIdx) => (
                        <button
                          type="button"
                          key={lha.id}
                          onClick={(e) => handleLhaSelect(lha, e)}
                          onDoubleClick={(e) => handleLhaLocate(lha, e)}
                          className={`flex w-full items-center gap-2 pl-8 pr-3 py-2 text-left transition-colors ${
                            grayed
                              ? "opacity-50 pointer-events-none"
                              : "hover:bg-tv-surface-hover cursor-pointer"
                          } ${lhaIdx < agl.lhas.length - 1 ? "border-b border-tv-border" : ""}`}
                          data-testid={`lha-item-${lha.id}`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: aglColor }}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium text-tv-text-primary">
                              {t("airport.lhaUnit", { designator: lha.unit_designator })}
                            </span>
                            <span className="text-xs text-tv-text-secondary ml-2">
                              {lha.setting_angle != null ? `${formatNumber(lha.setting_angle, 1)}°` : "—"}
                            </span>
                            {lha.position?.coordinates?.length >= 2 && (
                              <p className="text-[10px] text-tv-text-muted mt-0.5">
                                <CopyableValue text={formatLat(lha.position.coordinates[1], 8)} />
                                {", "}
                                <CopyableValue text={formatLon(lha.position.coordinates[0], 8)} />
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
