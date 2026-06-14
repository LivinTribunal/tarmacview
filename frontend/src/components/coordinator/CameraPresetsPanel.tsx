import { useState, useEffect, useCallback, useId } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Star, Pencil } from "lucide-react";
import {
  listCameraPresets,
  createCameraPreset,
  updateCameraPreset,
  deleteCameraPreset,
} from "@/api/cameraPresets";
import { WHITE_BALANCE_OPTIONS } from "@/constants/camera";
import type {
  CameraPresetResponse,
  CameraPresetUpdate,
  FocusMode,
  Iso,
  ShutterSpeed,
  WhiteBalance,
} from "@/types/cameraPreset";
import CameraSettingsGrid from "./CameraSettingsGrid";
import PresetEditRow from "./PresetEditRow";

interface CameraPresetsPanelProps {
  droneId: string | undefined;
}

/** chevron icon that rotates when expanded. */
function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** collapsible camera presets panel for a drone profile - list, edit, create defaults. */
export default function CameraPresetsPanel({ droneId: id }: CameraPresetsPanelProps) {
  const { t } = useTranslation();
  const newPresetNameId = useId();

  const [presetsExpanded, setPresetsExpanded] = useState(true);
  const [presets, setPresets] = useState<CameraPresetResponse[]>([]);
  const [newPresetName, setNewPresetName] = useState("");
  const [showNewPresetInput, setShowNewPresetInput] = useState(false);
  const [newPresetSettings, setNewPresetSettings] = useState<{
    white_balance?: WhiteBalance | null;
    iso?: Iso | null;
    shutter_speed?: ShutterSpeed | null;
    focus_mode?: FocusMode | null;
  }>({});
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editPresetData, setEditPresetData] = useState<CameraPresetUpdate & { name: string }>({
    name: "",
  });

  const fetchPresets = useCallback(() => {
    if (!id) return;
    listCameraPresets({ drone_profile_id: id, is_default: true })
      .then((res) => setPresets(res.data))
      .catch(() => setPresets([]));
  }, [id]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  return (
    <div className="bg-tv-surface border border-tv-border rounded-2xl flex flex-col min-h-0">
      <button
        type="button"
        onClick={() => setPresetsExpanded(!presetsExpanded)}
        className="flex items-center justify-between w-full px-4 py-3 flex-shrink-0"
        data-testid="presets-panel-toggle"
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-tv-bg px-3 py-1 text-xs font-medium text-tv-text-secondary uppercase tracking-wider">
            {t("coordinator.cameraPresets.title")}
          </span>
          <span className="rounded-full bg-tv-accent text-tv-accent-text px-2 py-0.5 text-xs font-semibold">
            {presets.length}
          </span>
        </div>
        <ChevronIcon expanded={presetsExpanded} />
      </button>

      {presetsExpanded && (
        <div className="px-4 pb-3 min-h-0">
          {presets.length === 0 && !showNewPresetInput && (
            <p className="text-sm text-tv-text-muted py-2">
              {t("coordinator.cameraPresets.noPresets")}
            </p>
          )}
          {presets.length > 0 && (
            <div className="flex flex-col gap-1 max-h-[280px] overflow-y-auto mb-2">
              {presets.map((p) =>
                editingPresetId === p.id ? (
                  <PresetEditRow
                    key={p.id}
                    presetId={p.id}
                    editPresetData={editPresetData}
                    setEditPresetData={setEditPresetData}
                    onSave={async () => {
                      try {
                        await updateCameraPreset(p.id, editPresetData);
                        setEditingPresetId(null);
                        fetchPresets();
                      } catch (err) {
                        console.error("update preset failed", err);
                      }
                    }}
                    onCancel={() => setEditingPresetId(null)}
                    onDelete={async () => {
                      try {
                        await deleteCameraPreset(p.id);
                        setEditingPresetId(null);
                        fetchPresets();
                      } catch (err) {
                        console.error("delete preset failed", err);
                      }
                    }}
                  />
                ) : (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className="flex items-center justify-between rounded-xl px-3 py-2 bg-tv-bg cursor-pointer hover:bg-tv-surface-hover transition-colors"
                  onClick={() => {
                    setEditingPresetId(p.id);
                    setEditPresetData({
                      name: p.name,
                      white_balance: p.white_balance,
                      iso: p.iso,
                      shutter_speed: p.shutter_speed,
                      focus_mode: p.focus_mode,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditingPresetId(p.id);
                      setEditPresetData({
                        name: p.name,
                        white_balance: p.white_balance,
                        iso: p.iso,
                        shutter_speed: p.shutter_speed,
                        focus_mode: p.focus_mode,
                      });
                    }
                  }}
                  data-testid={`preset-row-${p.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-tv-text-primary truncate">
                      {p.name}
                      {p.is_default && (
                        <span className="ml-2 text-[10px] font-semibold uppercase text-tv-accent">
                          {t("mission.config.cameraSettings.presetDefault")}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-tv-text-muted">
                      {[
                        WHITE_BALANCE_OPTIONS.find((o) => o.value === p.white_balance)?.label ?? p.white_balance,
                        p.iso ? `ISO ${p.iso}` : null,
                        p.shutter_speed,
                        p.focus_mode,
                      ].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await updateCameraPreset(p.id, { is_default: !p.is_default });
                        fetchPresets();
                      } catch (err) {
                        console.error("set default preset failed", err);
                      }
                    }}
                    className={`ml-2 p-1 rounded-full transition-colors ${p.is_default ? "text-tv-accent" : "text-tv-text-muted hover:text-tv-accent"}`}
                    title={t(p.is_default ? "coordinator.cameraPresets.unsetDefault" : "coordinator.cameraPresets.setDefault")}
                    data-testid={`preset-star-${p.id}`}
                  >
                    <Star className={`h-4 w-4 ${p.is_default ? "fill-current" : ""}`} />
                  </button>
                  <Pencil className="h-3 w-3 text-tv-text-muted flex-shrink-0 ml-2" />
                </div>
                ),
              )}
            </div>
          )}
          {showNewPresetInput ? (
            <div className="space-y-2 rounded-xl bg-tv-bg p-3">
              <div>
                <label
                  htmlFor={newPresetNameId}
                  className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary"
                >
                  {t("coordinator.cameraPresets.name")}
                </label>
                <input
                  id={newPresetNameId}
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder={t("coordinator.cameraPresets.namePlaceholder", t("coordinator.cameraPresets.name"))}
                  className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-surface text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
                  data-testid="new-preset-name"
                  autoFocus
                />
              </div>
              <CameraSettingsGrid
                testIdPrefix="new-preset"
                whiteBalance={newPresetSettings.white_balance ?? ""}
                iso={newPresetSettings.iso ?? ""}
                shutterSpeed={newPresetSettings.shutter_speed ?? ""}
                focusMode={newPresetSettings.focus_mode ?? ""}
                onWhiteBalanceChange={(raw) => setNewPresetSettings({ ...newPresetSettings, white_balance: (raw || null) as WhiteBalance | null })}
                onIsoChange={(raw) => setNewPresetSettings({ ...newPresetSettings, iso: (raw ? parseInt(raw) : null) as Iso | null })}
                onShutterSpeedChange={(raw) => setNewPresetSettings({ ...newPresetSettings, shutter_speed: (raw || null) as ShutterSpeed | null })}
                onFocusModeChange={(raw) => setNewPresetSettings({ ...newPresetSettings, focus_mode: (raw || null) as "AUTO" | "INFINITY" | null })}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!newPresetName.trim()) return;
                    try {
                      await createCameraPreset({
                        name: newPresetName.trim(),
                        drone_profile_id: id,
                        is_default: true,
                        white_balance: newPresetSettings.white_balance,
                        iso: newPresetSettings.iso,
                        shutter_speed: newPresetSettings.shutter_speed,
                        focus_mode: newPresetSettings.focus_mode,
                      });
                      setNewPresetName("");
                      setNewPresetSettings({});
                      setShowNewPresetInput(false);
                      fetchPresets();
                    } catch (err) {
                      console.error("create preset failed", err);
                    }
                  }}
                  disabled={!newPresetName.trim()}
                  className="px-3 py-1.5 rounded-full text-xs bg-tv-accent text-tv-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
                  data-testid="save-new-preset"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowNewPresetInput(false); setNewPresetName(""); setNewPresetSettings({}); }}
                  className="px-3 py-1.5 rounded-full text-xs border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNewPresetInput(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
              data-testid="add-preset-btn"
            >
              <Camera className="h-3 w-3" />
              {t("coordinator.cameraPresets.addPreset")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
