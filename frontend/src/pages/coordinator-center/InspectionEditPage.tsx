import { useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, X, Pencil, Copy, Trash2, Plus, Link } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import type { MapFeature } from "@/types/map";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import AirportMap from "@/components/map/AirportMap";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import DetailSelector from "@/components/common/DetailSelector";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";
import CreateTemplateDialog from "@/components/mission/CreateTemplateDialog";
import InspectionConfigCard from "@/components/mission/InspectionConfigCard";
import useTemplateAutosave from "@/hooks/useTemplateAutosave";
import useToast from "@/hooks/useToast";
import { methodBadgeStyle } from "@/utils/inspectionMethodBadge";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";

/** inspection template editor with autosave. */
export default function InspectionEditPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();

  const [isRenamingName, setIsRenamingName] = useState(false);
  const { message: notification, show: showNotif } = useToast(SLOW_NOTIFICATION_TIMEOUT_MS);

  // ui
  const [configExpanded, setConfigExpanded] = useState(true);

  // dialogs
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // selector dropdown
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorSearch, setSelectorSearch] = useState("");

  // map
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");

  const {
    template,
    allTemplates,
    loading,
    error,
    editConfig,
    editMethod,
    selectedAglId,
    selectedLhaIds,
    editName,
    lastSaved,
    saving,
    saveError,
    allAgls,
    fetchData,
    handleConfigChange,
    handleMethodChange,
    handleAglChange,
    handleToggleLha,
    handleSelectAllLhas,
    handleDeselectAllLhas,
    handleNameChange,
    handleDuplicate,
    handleDelete,
    handleCreate,
  } = useTemplateAutosave({
    id,
    airportDetail,
    navigate,
    t,
    showNotif,
    setShowCreate,
    setShowDelete,
  });

  // form-driven map highlight: ring follows the dropdown's AGL
  const focusFeature = useMemo<MapFeature | null>(() => {
    if (!selectedAglId) return null;
    const agl = allAgls.find((a) => a.id === selectedAglId);
    return agl ? { type: "agl", data: agl } : null;
  }, [selectedAglId, allAgls]);

  // form-driven multi-LHA highlight: rings follow the LHA checkbox set
  const focusLhaIds = useMemo(() => Array.from(selectedLhaIds), [selectedLhaIds]);

  function handleRenameFinish() {
    /**finish inline rename.*/
    setIsRenamingName(false);
  }

  function formatMethod(method: string) {
    /**format inspection method for display.*/
    return t(`map.inspectionMethodShort.${method}`, method);
  }

  const filteredTemplates = selectorSearch
    ? allTemplates.filter((tpl) => tpl.name.toLowerCase().includes(selectorSearch.toLowerCase()))
    : allTemplates;

  const handleSelectorToggle = useCallback(() => {
    /**toggle template selector dropdown.*/
    setSelectorOpen((prev) => {
      if (prev) setSelectorSearch("");
      return !prev;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-tv-error">{error ?? t("common.error")}</p>
        <Button onClick={fetchData}>{t("common.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="flex px-4 h-[calc(100vh-7rem)]" data-testid="inspection-edit-page">
      {/* left panel - 30% */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 pb-4" style={{ scrollbarGutter: "stable" }}>
          {/* template selector */}
          <DetailSelector
            title={t("coordinator.inspections.title")}
            count={allTemplates.length}
            actions={[
              { icon: Plus, onClick: () => setShowCreate(true), title: t("coordinator.inspections.addNew"), variant: "accent" },
              { icon: Copy, onClick: handleDuplicate, title: t("coordinator.inspections.duplicateTemplate") },
              { icon: Pencil, onClick: () => setIsRenamingName(true), title: t("coordinator.inspections.rename") },
              { icon: Trash2, onClick: () => setShowDelete(true), title: t("coordinator.inspections.deleteTemplate"), variant: "danger" },
              { icon: X, onClick: () => navigate("/coordinator-center/inspections"), title: t("common.close") },
            ]}
            renderSelected={() => (
              <>
                <span className="flex-1 text-tv-text-primary truncate font-medium">
                  {editName || template.name}
                </span>
                {(template.mission_count ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-tv-text-secondary" title={t("coordinator.inspections.usedInMissions", { count: template.mission_count ?? 0 })}>
                    <Link className="h-3 w-3" />
                    <span className="text-xs font-medium">{template.mission_count}</span>
                  </span>
                )}
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-xs"
                  style={methodBadgeStyle(template.methods[0] ?? "")}
                >
                  {formatMethod(template.methods[0] ?? "")}
                </span>
              </>
            )}
            isOpen={selectorOpen}
            onToggle={handleSelectorToggle}
            isRenaming={isRenamingName}
            renameValue={editName}
            onRenameChange={handleNameChange}
            onRenameFinish={handleRenameFinish}
            searchValue={selectorSearch}
            onSearchChange={setSelectorSearch}
            searchPlaceholder={t("coordinator.inspections.searchPlaceholder")}
            noResultsText={t("coordinator.inspections.noMatch")}
            renderDropdownItems={() =>
              filteredTemplates.length === 0 ? null : filteredTemplates.map((tpl) => (
                <DetailSelectorItem
                  key={tpl.id}
                  isSelected={tpl.id === template.id}
                  onClick={() => { navigate(`/coordinator-center/inspections/${tpl.id}`); handleSelectorToggle(); }}
                  disabled={tpl.id === template.id}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm truncate flex-1 ${tpl.id === template.id ? "font-medium" : "text-tv-text-primary"}`}>
                      {tpl.name}
                    </span>
                    {(tpl.mission_count ?? 0) > 0 && (
                      <span className={`flex items-center gap-0.5 ${tpl.id === template.id ? "text-tv-accent-text/70" : "text-tv-text-secondary"}`}>
                        <Link className="h-3 w-3" />
                        <span className="text-xs font-medium">{tpl.mission_count}</span>
                      </span>
                    )}
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${tpl.id === template.id ? "bg-tv-accent-text/20 text-tv-accent-text" : ""}`}
                      style={tpl.id === template.id ? {} : methodBadgeStyle(tpl.methods[0] ?? "")}
                    >
                      {formatMethod(tpl.methods[0] ?? "")}
                    </span>
                  </div>
                </DetailSelectorItem>
              ))
            }
          />

          {/* configuration form - collapsible container */}
          <InspectionConfigCard
            configExpanded={configExpanded}
            onToggleExpanded={() => setConfigExpanded(!configExpanded)}
            saving={saving}
            saveError={saveError}
            lastSaved={lastSaved}
            config={editConfig}
            method={editMethod}
            onChange={handleConfigChange}
            onMethodChange={handleMethodChange}
            allAgls={allAgls}
            selectedAglId={selectedAglId}
            onAglChange={handleAglChange}
            selectedLhaIds={selectedLhaIds}
            onToggleLha={handleToggleLha}
            onSelectAllLhas={handleSelectAllLhas}
            onDeselectAllLhas={handleDeselectAllLhas}
          />
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right panel - map */}
      <div className="flex-1 flex flex-col min-w-0 pb-4">
        {airportDetail ? (
          <div className="flex-1 relative rounded-2xl overflow-hidden border border-tv-border">
            <AirportMap
              airport={airportDetail}
              helpVariant="preview"
              terrainMode={terrainMode}
              onTerrainChange={setTerrainMode}
              showTerrainToggle={false}
              focusFeature={focusFeature}
              focusLhaIds={focusLhaIds}
            />

            {/* bottom right - terrain toggle */}
            <div className="absolute bottom-3 right-3 z-10">
              <TerrainToggle mode={terrainMode} onToggle={setTerrainMode} inline />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-tv-surface rounded-2xl border border-tv-border">
            <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
          </div>
        )}
      </div>

      {/* create dialog */}
      <CreateTemplateDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        agls={allAgls}
        onSubmit={handleCreate}
      />

      {/* delete confirmation */}
      <Modal
        isOpen={showDelete}
        onClose={() => setShowDelete(false)}
        title={t("coordinator.inspections.deleteTemplate")}
      >
        <p className="text-sm text-tv-text-secondary mb-4">
          {t("coordinator.inspections.deleteConfirm", { name: template.name })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setShowDelete(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      {/* notification toast */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl bg-tv-surface border border-tv-border text-sm text-tv-text-primary">
          {notification}
        </div>
      )}
    </div>
  );
}
