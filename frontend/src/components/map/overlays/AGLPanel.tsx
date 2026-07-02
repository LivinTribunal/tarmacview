import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { formatAglDisplayName } from "@/utils/agl";
import { aglColorForType } from "@/utils/aglColor";
import { formatNumber } from "@/utils/format";
import { formatLat, formatLon } from "@/utils/coordinates";
import CopyableValue from "@/components/common/CopyableValue";
import InfoHint from "@/components/common/InfoHint";
import ConfirmDeleteDialog from "@/components/coordinator/ConfirmDeleteDialog";

interface AGLPanelProps {
  surfaces: SurfaceResponse[];
  // when provided, drives the grayed/read-only state; omit for the editor
  layerConfig?: MapLayerConfig;
  // single-click: select only, no recenter
  onSelect: (feature: MapFeature) => void;
  // double-click: select AND recenter
  onLocate?: (feature: MapFeature) => void;
  // edit affordances (coordinator editor); omit for the read-only overlay
  onDeleteAgl?: (id: string) => Promise<void>;
  onDeleteLha?: (id: string) => Promise<void>;
  onAdd?: () => void;
}

export default function AGLPanel({
  surfaces,
  layerConfig,
  onSelect,
  onLocate,
  onDeleteAgl,
  onDeleteLha,
  onAdd,
}: AGLPanelProps) {
  /** collapsible list of agl systems with expandable lha sub-items; gains
   * delete/add affordances when the edit callbacks are supplied. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedAgls, setExpandedAgls] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<AGLResponse | null>(null);
  const [deleteLhaTarget, setDeleteLhaTarget] = useState<LHAResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allAgls = surfaces.flatMap((s) => s.agls);
  const count = allAgls.length;
  const grayed = layerConfig ? !layerConfig.aglSystems : false;

  const surfaceByAglId = useMemo(() => {
    /** map each agl id to its parent surface for the display name. */
    const map = new Map<string, SurfaceResponse>();
    for (const s of surfaces) {
      for (const agl of s.agls) map.set(agl.id, s);
    }
    return map;
  }, [surfaces]);

  function toggleExpand(aglId: string) {
    /** toggle expand/collapse state for an agl item. */
    setExpandedAgls((prev) => {
      const next = new Set(prev);
      if (next.has(aglId)) next.delete(aglId);
      else next.add(aglId);
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
    // browser fires two click events before dblclick; bail on the second
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
    <>
      <div className="rounded-2xl border border-tv-border bg-tv-bg" data-testid="agl-panel">
        <div className="flex w-full items-center justify-between px-3 py-2">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2 flex-1"
          >
            <span className="rounded-full px-3 py-1 bg-tv-surface border border-tv-border text-xs font-semibold text-tv-text-primary">
              {t("airport.aglSystems")}
            </span>
            <span className="flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1.5 text-[10px] font-semibold bg-tv-accent text-tv-accent-text">
              {count}
            </span>
          </button>
          <div className="flex items-center gap-1">
            {onDeleteAgl && (
              <InfoHint
                text={t("airport.aglSystemsHelp")}
                label={t("airport.aglSystems")}
                testId="hint-coordinator-agl-systems"
              />
            )}
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                title={t("coordinator.detail.addAgl")}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors text-tv-accent hover:bg-tv-text-primary/10"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setCollapsed(!collapsed)}>
              <ChevronDown
                className={`h-3.5 w-3.5 text-tv-text-muted transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
              />
            </button>
          </div>
        </div>

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
                const sortedLhas = agl.lhas.slice().sort((a, b) => a.sequence_number - b.sequence_number);
                return (
                  <div
                    key={agl.id}
                    className={idx < count - 1 ? "border-b border-tv-border" : ""}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        // bail on the second click of a double-click
                        if (e.detail > 1) return;
                        handleAglSelect(agl);
                        toggleExpand(agl.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleAglSelect(agl);
                          toggleExpand(agl.id);
                        }
                      }}
                      onDoubleClick={() => handleAglLocate(agl)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                        grayed
                          ? "opacity-50 pointer-events-none"
                          : "hover:bg-tv-surface-hover cursor-pointer"
                      }`}
                      data-testid={`agl-item-${agl.id}`}
                    >
                      <span
                        className="h-3 w-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: aglColor }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-tv-text-primary truncate">
                            {formatAglDisplayName(agl, surfaceByAglId.get(agl.id))}
                          </span>
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                            style={{ borderColor: aglColor, color: aglColor }}
                          >
                            {agl.agl_type === "RUNWAY_EDGE_LIGHTS" ? "REL" : agl.agl_type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {agl.side && (
                            <span className="text-[10px] text-tv-text-secondary">{agl.side}</span>
                          )}
                          <span className="text-[10px] text-tv-text-secondary">
                            {agl.lhas.length} {t("airport.units")}
                          </span>
                        </div>
                      </div>

                      {agl.lhas.length > 0 && (
                        <ChevronDown
                          className={`h-3 w-3 text-tv-text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                        />
                      )}

                      {onDeleteAgl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(agl);
                          }}
                          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors text-tv-text-secondary hover:bg-tv-error/15 hover:text-tv-error"
                          title={t("common.delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {expanded && agl.lhas.length > 0 && (
                      <div className="bg-tv-bg">
                        {sortedLhas.map((lha, lhaIdx) => (
                          <div
                            key={lha.id}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => handleLhaSelect(lha, e)}
                            onDoubleClick={(e) => handleLhaLocate(lha, e)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                if (!grayed) onSelect({ type: "lha", data: lha });
                              }
                            }}
                            className={`flex w-full items-center gap-2 pl-8 pr-3 py-2 text-left transition-colors ${
                              grayed
                                ? "opacity-50 pointer-events-none"
                                : "hover:bg-tv-surface-hover cursor-pointer"
                            } ${lhaIdx < sortedLhas.length - 1 ? "border-b border-tv-border" : ""}`}
                            data-testid={`lha-item-${lha.id}`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: aglColor }}
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-semibold text-tv-text-secondary mr-1">
                                #{lha.sequence_number}
                              </span>
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
                            {onDeleteLha && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteLhaTarget(lha);
                                }}
                                className="w-6 h-6 rounded-full flex items-center justify-center transition-colors text-tv-text-secondary hover:bg-tv-error/15 hover:text-tv-error flex-shrink-0"
                                title={t("common.delete")}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
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

      {onDeleteAgl && (
        <ConfirmDeleteDialog
          isOpen={deleteTarget !== null}
          name={deleteTarget?.name ?? ""}
          error={deleteError}
          onConfirm={async () => {
            if (!deleteTarget) return;
            setDeleteError(null);
            try {
              await onDeleteAgl(deleteTarget.id);
              setDeleteTarget(null);
            } catch (err) {
              setDeleteError(
                err instanceof Error && err.message ? err.message : t("coordinator.detail.deleteError"),
              );
            }
          }}
          onCancel={() => {
            setDeleteError(null);
            setDeleteTarget(null);
          }}
        />
      )}

      {onDeleteLha && (
        <ConfirmDeleteDialog
          isOpen={deleteLhaTarget !== null}
          name={deleteLhaTarget ? t("airport.lhaUnit", { designator: deleteLhaTarget.unit_designator }) : ""}
          error={deleteError}
          onConfirm={async () => {
            if (!deleteLhaTarget) return;
            setDeleteError(null);
            try {
              await onDeleteLha(deleteLhaTarget.id);
              setDeleteLhaTarget(null);
            } catch (err) {
              setDeleteError(
                err instanceof Error && err.message ? err.message : t("coordinator.detail.deleteError"),
              );
            }
          }}
          onCancel={() => {
            setDeleteError(null);
            setDeleteLhaTarget(null);
          }}
        />
      )}
    </>
  );
}
