import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { Layers, Clock, Star, ArrowLeftRight, X, Loader2 } from "lucide-react";
import Card from "@/components/common/Card";
import DetailSelector from "@/components/common/DetailSelector";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";
import BulkChangeDroneDialog from "@/components/drone/BulkChangeDroneDialog";
import DroneMissionsPanel from "@/components/drone/DroneMissionsPanel";
import DroneModelViewer from "@/components/drone/DroneModelViewer";
import DroneSpecGrid from "@/components/drone/DroneSpecGrid";
import { useAirport } from "@/contexts/AirportContext";
import useOperatorDroneDetail from "@/hooks/useOperatorDroneDetail";
import { formatDate, formatDuration } from "@/utils/format";

/** star icon that renders filled when active. */
function FilledStar({ className }: { className?: string }) {
  return <Star className={className} fill="currentColor" />;
}

/** read-only operator drone detail page. */
export default function OperatorDroneDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { selectedAirport } = useAirport();

  const detail = useOperatorDroneDetail({ id });
  const {
    drone,
    allDrones,
    missions,
    loading,
    error,
    defaultDroneId,
    isDefault,
    totalDuration,
    modelUrl,
    fetchDrone,
    toggleDefault,
    notification,
    showToast,
  } = detail;

  const [showSelector, setShowSelector] = useState(false);
  const [droneSearch, setDroneSearch] = useState("");
  const [missionsExpanded, setMissionsExpanded] = useState(true);
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const filteredDrones = droneSearch
    ? allDrones.filter((d) =>
        d.name.toLowerCase().includes(droneSearch.toLowerCase()),
      )
    : allDrones;

  /** navigate to a different drone profile. */
  function handleSelectDrone(droneId: string) {
    setShowSelector(false);
    setDroneSearch("");
    if (droneId === id) return;
    navigate(`/operator-center/drones/${droneId}`);
  }

  /** toggle the drone selector dropdown. */
  function handleSelectorToggle() {
    setShowSelector((prev) => {
      if (prev) setDroneSearch("");
      return !prev;
    });
  }

  /** toggle default drone and surface the right toast. */
  async function handleToggleDefault() {
    const wasDefault = isDefault;
    const ok = await toggleDefault();
    if (!ok) {
      showToast(t("common.error"));
      return;
    }
    showToast(
      wasDefault
        ? t("operatorDrones.removeDefault")
        : t("operatorDrones.defaultBadge"),
    );
  }

  /** handle bulk change success. */
  function handleBulkSuccess(updatedCount: number, regressedCount: number) {
    if (updatedCount === 0) {
      showToast(t("operatorDrones.noMissions"));
    } else {
      let msg = t("operatorDrones.bulkChangeSuccess", { count: updatedCount });
      if (regressedCount > 0) {
        msg += ` (${t("operatorDrones.bulkRegressed", { count: regressedCount })})`;
      }
      showToast(msg);
    }
    fetchDrone();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg">
        <Loader2 className="h-6 w-6 animate-spin text-tv-text-muted" />
      </div>
    );
  }

  if (error || !drone) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg">
        <p className="text-sm text-tv-error">
          {t("coordinator.drones.loadError")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full px-4 bg-tv-bg">
      {/* left panel - 30% matching navbar app title width */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div
          className="flex-1 flex flex-col gap-4 min-h-0 pb-4"
          style={{ scrollbarGutter: "stable" }}
        >
          <DetailSelector
            title={t("operatorDrones.title")}
            count={allDrones.length}
            actions={[
              {
                icon: isDefault ? FilledStar : Star,
                onClick: handleToggleDefault,
                title: isDefault
                  ? t("operatorDrones.removeDefault")
                  : t("operatorDrones.setDefault"),
                variant: isDefault ? "accent" : "default",
              },
              {
                icon: ArrowLeftRight,
                onClick: () => setShowBulkDialog(true),
                title: t("operatorDrones.bulkChange"),
              },
              {
                icon: X,
                onClick: () => navigate("/operator-center/drones"),
                title: t("coordinator.drones.detail.backToList"),
              },
            ]}
            renderSelected={() => (
              <>
                <span className="flex-1 text-tv-text-primary truncate font-medium">
                  {drone.name}
                </span>
                {isDefault && (
                  <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--tv-status-validated-bg)] text-[var(--tv-status-validated-text)]">
                    {t("operatorDrones.defaultBadge")}
                  </span>
                )}
                {missions.length > 0 && (
                  <span className="flex items-center gap-0.5 text-tv-text-secondary">
                    <Layers className="h-3 w-3" />
                    <span className="text-xs font-medium">
                      {missions.length}
                    </span>
                  </span>
                )}
              </>
            )}
            isOpen={showSelector}
            onToggle={handleSelectorToggle}
            searchValue={droneSearch}
            onSearchChange={setDroneSearch}
            searchPlaceholder={t("coordinator.drones.searchPlaceholder")}
            noResultsText={t("coordinator.drones.noMatch")}
            renderDropdownItems={() =>
              filteredDrones.length === 0
                ? null
                : filteredDrones.map((d) => {
                    const isSelected = d.id === id;
                    const isDroneDefault = defaultDroneId === d.id;
                    return (
                      <DetailSelectorItem
                        key={d.id}
                        isSelected={isSelected}
                        onClick={() => {
                          handleSelectDrone(d.id);
                          handleSelectorToggle();
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-sm">
                            {d.name}
                            {isDroneDefault && (
                              <span className="ml-1.5 text-xs text-tv-accent font-normal">
                                ({t("operatorDrones.defaultBadge")})
                              </span>
                            )}
                          </span>
                        </div>
                        <div
                          className={`flex items-center gap-3 text-xs mt-0.5 ${isSelected ? "text-tv-accent-text/70" : "text-tv-text-muted"}`}
                        >
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3" />
                            {isSelected ? missions.length : d.mission_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {isSelected && totalDuration > 0
                              ? formatDuration(totalDuration)
                              : "—"}
                          </span>
                          <span className="ml-auto">
                            {formatDate(d.updated_at)}
                          </span>
                        </div>
                      </DetailSelectorItem>
                    );
                  })
            }
          />

          <DroneMissionsPanel
            missions={missions}
            expanded={missionsExpanded}
            onToggle={() => setMissionsExpanded(!missionsExpanded)}
            headerLabel={t("operatorDrones.missionsUsing")}
            emptyLabel={t("operatorDrones.noMissionsForDrone")}
            emptyItalic
            maxHeightClass="max-h-[280px]"
            onMissionClick={(m) =>
              navigate(`/operator-center/missions/${m.id}/overview`)
            }
            renderSubtitle={(m) =>
              t("operatorDrones.lastSaved", { date: formatDate(m.updated_at) })
            }
          />
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right section */}
      <div
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="flex gap-4">
          {/* center panel - drone specs (read-only) */}
          <div className="flex-1 min-w-0">
            <Card className="p-6">
              <h2 className="text-base font-semibold text-tv-text-primary mb-6">
                {drone.name}
              </h2>

              <DroneSpecGrid drone={drone} />

              <p className="mt-6 text-xs text-tv-text-muted italic">
                {t("operatorDrones.contactCoordinator")}
              </p>
            </Card>
          </div>

          {/* right panel - 3d model viewer */}
          <div
            className="relative flex-shrink-0 rounded-2xl border border-[var(--tv-border)] bg-[var(--tv-surface)] overflow-hidden"
            style={{ width: "calc(280px + 16px + 76px + 16px + 140px)" }}
            data-testid="model-viewer-section"
          >
            <DroneModelViewer modelUrl={modelUrl} />
          </div>
        </div>
      </div>

      {drone && selectedAirport && (
        <BulkChangeDroneDialog
          isOpen={showBulkDialog}
          onClose={() => setShowBulkDialog(false)}
          airportId={selectedAirport.id}
          currentDroneId={drone.id}
          currentDroneName={drone.name}
          allDrones={allDrones}
          onSuccess={handleBulkSuccess}
        />
      )}

      {notification && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-tv-border bg-tv-surface px-4 py-3 text-sm text-tv-text-primary">
          {notification}
        </div>
      )}
    </div>
  );
}
