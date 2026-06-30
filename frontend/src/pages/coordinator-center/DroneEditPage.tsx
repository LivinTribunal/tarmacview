import { useTranslation } from "react-i18next";
import { Layers, Clock, Pencil, Plus, Copy, Trash2, X, Link, Loader2 } from "lucide-react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DetailSelector from "@/components/common/DetailSelector";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";
import Modal from "@/components/common/Modal";
import Input from "@/components/common/Input";
import DroneModelViewer from "@/components/drone/DroneModelViewer";
import ModelSelectorOverlay from "@/components/drone/ModelSelectorOverlay";
import DroneMissionsPanel from "@/components/drone/DroneMissionsPanel";
import CameraPresetsPanel from "@/components/coordinator/CameraPresetsPanel";
import useDroneEditor from "@/hooks/useDroneEditor";
import { FIELDS } from "@/config/droneFields";
import { formatDate, formatDuration } from "@/utils/format";

/** format a date as a human-readable saved timestamp. */
function formatTimestamp(
  date: Date,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t("coordinator.drones.detail.savedJustNow");
  if (diffMin < 60)
    return t("coordinator.drones.detail.savedMinutesAgo", { count: diffMin });

  return t("coordinator.drones.detail.savedAt", {
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
}

/** drone profile editor with autosave. */
export default function DroneEditPage() {
  const { t } = useTranslation();
  const editor = useDroneEditor();
  const {
    id,
    drone,
    allDrones,
    missions,
    filteredDrones,
    totalDuration,
    loading,
    error,
    formData,
    nameError,
    lastSaved,
    saving,
    saveError,
    notification,
  } = editor;

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
          {/* drone selector */}
          <DetailSelector
            title={t("coordinator.drones.title")}
            count={allDrones.length}
            actions={[
              { icon: Plus, onClick: () => { editor.setShowCreateDialog(true); editor.setCreateName(""); editor.setCreateError(""); }, title: t("coordinator.drones.detail.addNew"), variant: "accent" },
              { icon: Copy, onClick: editor.handleDuplicate, title: t("coordinator.drones.detail.duplicate") },
              { icon: Pencil, onClick: editor.startDroneRename, title: t("coordinator.drones.detail.rename") },
              { icon: Trash2, onClick: () => editor.setShowDeleteDialog(true), title: t("coordinator.drones.detail.delete"), variant: "danger" },
              { icon: X, onClick: editor.handleBackToList, title: t("coordinator.drones.detail.backToList") },
            ]}
            renderSelected={() => (
              <>
                <span className="flex-1 text-tv-text-primary truncate font-medium">
                  {drone.name}
                </span>
                {(drone.mission_count ?? 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-tv-text-secondary">
                    <Link className="h-3 w-3" />
                    <span className="text-xs font-medium">{drone.mission_count}</span>
                  </span>
                )}
              </>
            )}
            isOpen={editor.showSelector}
            onToggle={editor.handleSelectorToggle}
            isRenaming={editor.isRenamingDrone}
            renameValue={editor.renameDroneValue}
            onRenameChange={editor.setRenameDroneValue}
            onRenameFinish={editor.finishDroneRename}
            searchValue={editor.droneSearch}
            onSearchChange={editor.setDroneSearch}
            searchPlaceholder={t("coordinator.drones.searchPlaceholder")}
            noResultsText={t("coordinator.drones.noMatch")}
            renderDropdownItems={() =>
              filteredDrones.length === 0 ? null : filteredDrones.map((d) => {
                const isSelected = d.id === id;
                return (
                  <DetailSelectorItem
                    key={d.id}
                    isSelected={isSelected}
                    onClick={() => { editor.handleSelectDrone(d.id); editor.handleSelectorToggle(); }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-sm">
                        {d.name}
                      </span>
                    </div>
                    <div className={`flex items-center gap-3 text-xs mt-0.5 ${isSelected ? "text-tv-accent-text/70" : "text-tv-text-muted"}`}>
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        {isSelected ? missions.length : d.mission_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {isSelected && totalDuration > 0 ? formatDuration(totalDuration) : "\u2014"}
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

          {/* missions panel */}
          <DroneMissionsPanel
            missions={missions}
            expanded={editor.missionsExpanded}
            onToggle={() => editor.setMissionsExpanded(!editor.missionsExpanded)}
          />

          {/* camera presets panel */}
          <CameraPresetsPanel droneId={id} />
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right section - mirrors navbar right flex structure */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
        <div className="flex gap-4">

          {/* center panel - drone details (mirrors nav pills flex-1) */}
          <div className="flex-1 min-w-0">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-semibold text-tv-text-primary">
                  {drone.name}
                </h2>

                {/* saved status indicator */}
                <span className="text-xs text-tv-text-muted flex items-center gap-1.5">
                  {saving && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t("coordinator.drones.detail.saving")}
                    </>
                  )}
                  {!saving && saveError && (
                    <span className="text-tv-error">
                      {t("coordinator.drones.detail.saveError")}
                    </span>
                  )}
                  {!saving && !saveError && lastSaved && (
                    <>
                      <svg
                        className="h-3 w-3 text-tv-success"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {formatTimestamp(lastSaved, t)}
                    </>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {FIELDS.map((field) => {
                  const label = t(`coordinator.drones.fields.${field.labelKey}`);
                  const unitLabel = field.unitKey
                    ? t(`coordinator.drones.units.${field.unitKey}`)
                    : "";

                  return (
                    <div key={field.key}>
                      <Input
                        id={`edit-${field.key}`}
                        label={unitLabel ? `${label} (${unitLabel})` : label}
                        type={field.type}
                        step={field.type === "number" ? "any" : undefined}
                        value={formData[field.key] ?? ""}
                        onChange={(e) =>
                          editor.handleFieldChange(field.key, e.target.value)
                        }
                        data-testid={`edit-${field.key}`}
                      />
                      {field.key === "name" && nameError && (
                        <p
                          className="mt-1 text-sm text-tv-error"
                          data-testid="name-error"
                        >
                          {nameError}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* right panel - 3d model viewer, width = airport selector + theme toggle + user dropdown + gaps */}
          <div
            className="relative flex-shrink-0 rounded-2xl border border-[var(--tv-border)] bg-[var(--tv-surface)] overflow-hidden"
            style={{ width: "calc(280px + 16px + 76px + 16px + 140px)" }}
            data-testid="model-viewer-section"
          >
            <DroneModelViewer modelUrl={editor.resolveModelUrl(drone.model_identifier)} />

            {/* model selector overlay - top right */}
            <ModelSelectorOverlay
              selectedModelId={drone.model_identifier}
              onSelectModel={editor.handleSelectModel}
              onRemoveModel={editor.handleRemoveModel}
              onUploadCustom={editor.handleUploadCustomModel}
              onInvalidFile={(msg) => editor.showToast(msg)}
            />
          </div>

        </div> {/* end inner flex */}
      </div> {/* end right section */}

      {/* toast notification */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-tv-border bg-tv-surface px-4 py-3 text-sm text-tv-text-primary">
          {notification}
        </div>
      )}

      {/* create dialog */}
      <Modal
        isOpen={editor.showCreateDialog}
        onClose={() => {
          editor.setShowCreateDialog(false);
          editor.setCreateName("");
          editor.setCreateError("");
        }}
        title={t("coordinator.drones.create.title")}
      >
        <form onSubmit={editor.handleCreateNew}>
          <Input
            id="detail-create-name"
            label={t("coordinator.drones.fields.name")}
            value={editor.createName}
            onChange={(e) => editor.setCreateName(e.target.value)}
            placeholder={t("coordinator.drones.create.namePlaceholder")}
            required
            data-testid="detail-create-name"
          />
          {editor.createError && (
            <p className="mt-2 text-sm text-tv-error">{editor.createError}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                editor.setShowCreateDialog(false);
                editor.setCreateName("");
                editor.setCreateError("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!editor.createName.trim()}>
              {t("coordinator.drones.create.add")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* delete confirmation */}
      <Modal
        isOpen={editor.showDeleteDialog}
        onClose={() => editor.setShowDeleteDialog(false)}
        title={t("coordinator.drones.delete.title")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("coordinator.drones.delete.confirm", { name: drone.name })}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => editor.setShowDeleteDialog(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={editor.handleDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
