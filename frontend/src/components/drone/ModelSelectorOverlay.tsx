import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { BUNDLED_DRONE_MODELS, getBundledModel } from "@/config/droneModels";
import { isValidModelFile } from "@/utils/droneModelFile";

interface ModelSelectorOverlayProps {
  selectedModelId: string | null;
  onSelectModel: (modelId: string) => void;
  onRemoveModel: () => void;
  onUploadCustom?: (file: File) => void;
  onInvalidFile?: (message: string) => void;
}

/** compact model selector dropdown overlaid on the 3d viewer. */
export default function ModelSelectorOverlay({
  selectedModelId,
  onSelectModel,
  onRemoveModel,
  onUploadCustom,
  onInvalidFile,
}: ModelSelectorOverlayProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedModel = selectedModelId
    ? getBundledModel(selectedModelId)
    : null;
  const displayLabel = selectedModel?.name ?? (selectedModelId ? t("drone.customModel") : t("drone.noModelAssigned"));

  /** handle custom file upload. */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isValidModelFile(file)) {
      onInvalidFile?.(t("drone.invalidFileType"));
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    onUploadCustom?.(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setOpen(false);
  }

  return (
    <div ref={ref} className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
      {/* model dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium
            bg-[var(--tv-surface)]/90 backdrop-blur-sm border border-[var(--tv-border)]
            text-[var(--tv-text-primary)] hover:bg-[var(--tv-surface-hover)] transition-colors"
          data-testid="model-dropdown-trigger"
        >
          <span className="max-w-[140px] truncate">{displayLabel}</span>
          <svg
            className={`h-3 w-3 flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 min-w-[200px] rounded-2xl border border-[var(--tv-border)] bg-[var(--tv-surface)] p-1.5 z-50 shadow-lg">
            {BUNDLED_DRONE_MODELS.map((model) => {
              const isSelected = selectedModelId === model.id;
              return (
                <button
                  type="button"
                  key={model.id}
                  onClick={() => {
                    onSelectModel(model.id);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 w-full rounded-xl px-3 py-2 text-xs transition-colors ${isSelected
                      ? "bg-[var(--tv-nav-active-bg)] text-[var(--tv-nav-active-text)]"
                      : "text-[var(--tv-text-primary)] hover:bg-[var(--tv-surface-hover)]"
                    }`}
                  data-testid={`model-option-${model.id}`}
                >
                  <img
                    src={model.thumbnail}
                    alt={model.name}
                    className="h-7 w-7 rounded-md object-cover flex-shrink-0"
                  />
                  <span className="truncate">{model.name}</span>
                </button>
              );
            })}

            {selectedModelId && (
              <>
                <div className="mx-2 my-1 border-t border-[var(--tv-border)]" />
                <button
                  type="button"
                  onClick={() => {
                    onRemoveModel();
                    setOpen(false);
                  }}
                  className="w-full text-left rounded-xl px-3 py-2 text-xs text-[var(--tv-text-muted)] hover:bg-[var(--tv-surface-hover)] transition-colors"
                  data-testid="remove-model-option"
                >
                  {t("drone.removeModel")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* add model (upload) button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium
          bg-[var(--tv-accent)] text-[var(--tv-accent-text)] hover:bg-[var(--tv-accent-hover)] transition-colors"
        title={t("drone.addModel")}
        data-testid="add-model-button"
      >
        <Plus className="h-3 w-3" />
        <span>{t("drone.addModel")}</span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFileChange}
        aria-label={t("drone.addModel")}
        className="hidden"
        data-testid="model-file-input"
      />
    </div>
  );
}
