import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { ExternalLink } from "lucide-react";
import Button from "@/components/common/Button";
import { useAirport } from "@/contexts/AirportContext";
import AirportMap, { type AirportMapHandle } from "@/components/map/AirportMap";
import LegendPanel from "@/components/map/overlays/LegendPanel";
import AirportInfoPanel from "@/components/map/overlays/AirportInfoPanel";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import AirportAssignedUsersPanel from "@/components/admin/AirportAssignedUsersPanel";
import AirportActivityPanel from "@/components/admin/AirportActivityPanel";
import useSuperAdminAirportDetail from "@/hooks/useSuperAdminAirportDetail";
import { WARNING_SURFACE, WARNING_SURFACE_BORDER } from "@/pages/super-admin/badgeStyles";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";

/** super-admin per-airport detail page: overview + assigned users + map + activity. */
export default function SuperAdminAirportDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: airportId } = useParams<{ id: string }>();
  const { selectAirport } = useAirport();

  const {
    airport,
    airportDetail,
    assignedUsers,
    activity,
    loadFailed,
    unassigned,
    handleAddUser,
    handleRemoveUser,
    formatTs,
    openInCoordinator,
  } = useSuperAdminAirportDetail({ airportId, navigate, selectAirport });

  // map viewer state
  const mapHandleRef = useRef<AirportMapHandle>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [layerConfig, setLayerConfig] = useState<MapLayerConfig>(DEFAULT_LAYER_CONFIG);
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [is3D, setIs3D] = useState(false);

  if (loadFailed) {
    return (
      <div className="px-4 pt-2 pb-6">
        <button
          type="button"
          onClick={() => navigate("/super-admin/airports")}
          className="text-sm text-tv-text-secondary hover:text-tv-text-primary transition-colors"
        >
          &larr; {t("admin.airportDetail.back")}
        </button>
        <p className="mt-4 text-sm text-[var(--tv-error)]">
          {t("admin.airportDetail.loadFailed")}
        </p>
      </div>
    );
  }

  if (!airport) {
    return (
      <div className="px-4 pt-2 pb-6">
        <p className="text-sm text-tv-text-muted">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 pb-6" data-testid="admin-airport-detail-page">
      <div className="mb-3">
        <button
          type="button"
          onClick={() => navigate("/super-admin/airports")}
          className="text-sm text-tv-text-secondary hover:text-tv-text-primary transition-colors"
        >
          &larr; {t("admin.airportDetail.back")}
        </button>
      </div>

      <div className="flex">
        {/* left column - overview + assigned users (mirrors user-detail layout) */}
        <div className="w-[30%] flex-shrink-0 flex">
          <div className="flex-1 space-y-4">
            {airport.coordinator_count === 0 && (
              <div
                className="rounded-2xl border p-4 text-sm"
                style={{ ...WARNING_SURFACE, borderColor: WARNING_SURFACE_BORDER }}
                data-testid="orphaned-warning"
              >
                <p className="font-semibold">{t("admin.airportDetail.orphanedTitle")}</p>
                <p className="mt-1 text-tv-text-secondary">
                  {t("admin.airportDetail.orphanedHint")}
                </p>
              </div>
            )}

            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
              <h3 className="text-base font-semibold text-tv-text-primary mb-1">
                {airport.name}
              </h3>
              <p className="text-sm text-tv-text-secondary">{airport.icao_code}</p>
              <p className="text-xs text-tv-text-muted mt-0.5">
                {[airport.city, airport.country].filter(Boolean).join(", ") || "—"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-tv-text-muted">
                <div>
                  <dt className="text-tv-text-secondary">{t("admin.columns.users")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.user_count}</dd>
                </div>
                <div>
                  <dt className="text-tv-text-secondary">{t("admin.columns.coordinators")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.coordinator_count}</dd>
                </div>
                <div>
                  <dt className="text-tv-text-secondary">{t("admin.columns.operators")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.operator_count}</dd>
                </div>
                <div>
                  <dt className="text-tv-text-secondary">{t("admin.columns.missions")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.mission_count}</dd>
                </div>
                <div>
                  <dt className="text-tv-text-secondary">{t("admin.columns.drones")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.drone_count}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-tv-text-secondary">{t("admin.columns.terrainSource")}</dt>
                  <dd className="text-sm text-tv-text-primary">{airport.terrain_source}</dd>
                </div>
              </dl>
            </div>

            <AirportAssignedUsersPanel
              assignedUsers={assignedUsers}
              unassigned={unassigned}
              onAddUser={handleAddUser}
              onRemoveUser={handleRemoveUser}
            />
          </div>
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* right area - map + activity/quick-actions sidebar */}
        <div className="flex-1 flex gap-4 min-w-0">
          {/* center: airport map */}
          <div
            className="flex-1 min-w-0 relative h-[680px] rounded-2xl overflow-hidden border border-tv-border bg-tv-bg"
            data-testid="airport-map-container"
          >
            {airportDetail ? (
              <AirportMap
                ref={mapHandleRef}
                airport={airportDetail}
                interactive={true}
                showLayerPanel={true}
                showLegend={false}
                showPoiInfo={true}
                showWaypointList={false}
                helpVariant="preview"
                terrainMode={terrainMode}
                onTerrainChange={setTerrainMode}
                onFeatureClick={setSelectedFeature}
                onLayerChange={setLayerConfig}
                focusFeature={selectedFeature}
                is3D={is3D}
                onToggle3D={setIs3D}
              >
                <div
                  className="absolute top-3 right-3 bottom-[60px] z-10 w-56 flex flex-col gap-2 overflow-y-auto pr-1"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <LegendPanel
                    layers={layerConfig}
                    className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
                  />
                  <AirportInfoPanel
                    airport={airportDetail}
                    className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
                  />
                </div>
                <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
                  <div className="flex rounded-full border border-tv-border bg-tv-surface p-1">
                    <button
                      type="button"
                      onClick={() => setIs3D(false)}
                      title={t("map.toggle2d")}
                      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                        !is3D
                          ? "bg-tv-accent text-tv-accent-text"
                          : "text-tv-text-secondary hover:text-tv-text-primary"
                      }`}
                    >
                      2D
                    </button>
                    <button
                      type="button"
                      onClick={() => setIs3D(true)}
                      title={t("map.toggle3d")}
                      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                        is3D
                          ? "bg-tv-accent text-tv-accent-text"
                          : "text-tv-text-secondary hover:text-tv-text-primary"
                      }`}
                    >
                      3D
                    </button>
                  </div>
                  <TerrainToggle mode={terrainMode} onToggle={setTerrainMode} inline />
                </div>
              </AirportMap>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-tv-text-muted">
                {t("common.loading")}
              </div>
            )}
          </div>

          {/* right: activity, then quick actions below it */}
          <div className="w-[396px] flex-shrink-0 space-y-4">
            <AirportActivityPanel
              activity={activity}
              airportId={airport.id}
              formatTs={formatTs}
            />

            <div
              className="bg-tv-surface border border-tv-border rounded-2xl p-4 space-y-3"
              data-testid="airport-quick-actions"
            >
              <h3 className="text-base font-semibold text-tv-text-primary">
                {t("admin.airportDetail.quickActions")}
              </h3>
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => openInCoordinator()}
                disabled={!airportDetail}
                data-testid="open-coordinator-center-button"
              >
                <span className="flex items-center justify-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  {t("admin.airportDetail.openCoordinatorCenter")}
                </span>
              </Button>
              <Button
                variant="secondary"
                className="w-full justify-center"
                onClick={() => openInCoordinator("action=bulk-change-drone")}
                disabled={!airportDetail}
                data-testid="bulk-change-drone-button"
              >
                {t("admin.airportDetail.bulkChangeDrone")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
