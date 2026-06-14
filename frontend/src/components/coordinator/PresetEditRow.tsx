import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type {
  CameraPresetUpdate,
  WhiteBalance,
  Iso,
  ShutterSpeed,
} from "@/types/cameraPreset";
import CameraSettingsGrid from "./CameraSettingsGrid";

interface PresetEditRowProps {
  presetId: string;
  editPresetData: CameraPresetUpdate & { name: string };
  setEditPresetData: (data: CameraPresetUpdate & { name: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

/** inline edit form for a single camera preset. */
export default function PresetEditRow({
  presetId,
  editPresetData,
  setEditPresetData,
  onSave,
  onCancel,
  onDelete,
}: PresetEditRowProps) {
  const { t } = useTranslation();
  const nameId = useId();
  return (
    <div className="space-y-2 rounded-xl bg-tv-bg p-3">
      <div>
        <label
          htmlFor={nameId}
          className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary"
        >
          {t("coordinator.cameraPresets.name")}
        </label>
        <input
          id={nameId}
          type="text"
          value={editPresetData.name}
          onChange={(e) => setEditPresetData({ ...editPresetData, name: e.target.value })}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-surface text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
          data-testid={`edit-preset-name-${presetId}`}
        />
      </div>
      <CameraSettingsGrid
        whiteBalance={editPresetData.white_balance ?? ""}
        iso={editPresetData.iso ?? ""}
        shutterSpeed={editPresetData.shutter_speed ?? ""}
        focusMode={editPresetData.focus_mode ?? ""}
        onWhiteBalanceChange={(raw) => setEditPresetData({ ...editPresetData, white_balance: (raw || null) as WhiteBalance | null })}
        onIsoChange={(raw) => setEditPresetData({ ...editPresetData, iso: (raw ? parseInt(raw) : null) as Iso | null })}
        onShutterSpeedChange={(raw) => setEditPresetData({ ...editPresetData, shutter_speed: (raw || null) as ShutterSpeed | null })}
        onFocusModeChange={(raw) => setEditPresetData({ ...editPresetData, focus_mode: (raw || null) as "AUTO" | "INFINITY" | null })}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!editPresetData.name.trim()}
          className="px-3 py-1.5 rounded-full text-xs bg-tv-accent text-tv-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-full text-xs border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto p-1 rounded-full text-tv-text-muted hover:text-tv-error transition-colors"
          title={t("coordinator.cameraPresets.deletePreset")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
