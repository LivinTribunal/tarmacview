import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import Modal from "@/components/common/Modal";
import {
  confirmMeasurementLights,
  getMeasurementPreview,
  getMeasurementStatus,
} from "@/api/measurements";
import { apiErrorMessage } from "@/utils/apiError";
import type { LightBox, MeasurementStatus } from "@/types/measurement";

interface MeasurementFlowDialogProps {
  /** the run to review - opened only for AWAITING_CONFIRM rows from the list. */
  measurementId: string;
  inspectionLabel: string;
  onClose: () => void;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** review step for one measurement: confirm/adjust the detected PAPI boxes, then hand back. */
export default function MeasurementFlowDialog({
  measurementId,
  inspectionLabel,
  onClose,
}: MeasurementFlowDialogProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<MeasurementStatus | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [boxes, setBoxes] = useState<LightBox[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const imageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // seed the current status of the run we're reviewing (no polling - the run
  // sits in AWAITING_CONFIRM until the operator confirms here)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const s = await getMeasurementStatus(measurementId);
        if (!mountedRef.current) return;
        setStatus(s.status);
        if (s.status === "ERROR") setErrorMessage(s.error_message);
      } catch (err) {
        if (!mountedRef.current) return;
        setUiError(apiErrorMessage(err, t("mission.measurementFlow.previewError")));
      }
    })();
  }, [measurementId, t]);

  // fetch the first frame + detected boxes once we know it's awaiting confirmation
  useEffect(() => {
    if (status !== "AWAITING_CONFIRM" || previewLoaded) return;
    void (async () => {
      try {
        const preview = await getMeasurementPreview(measurementId);
        if (!mountedRef.current) return;
        setPreviewUrl(preview.first_frame_url);
        setBoxes(preview.boxes);
        setPreviewLoaded(true);
      } catch (err) {
        if (!mountedRef.current) return;
        setUiError(apiErrorMessage(err, t("mission.measurementFlow.previewError")));
      }
    })();
  }, [status, measurementId, previewLoaded, t]);

  // confirm the boxes and start processing; the list + progress toast take over
  async function handleConfirm() {
    setConfirming(true);
    setUiError(null);
    try {
      await confirmMeasurementLights(measurementId, boxes);
      if (!mountedRef.current) return;
      onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setUiError(apiErrorMessage(err, t("mission.measurementFlow.confirmError")));
    } finally {
      if (mountedRef.current) setConfirming(false);
    }
  }

  function moveBox(clientX: number, clientY: number) {
    if (dragIndex === null || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = clampPct(((clientX - rect.left) / rect.width) * 100);
    const y = clampPct(((clientY - rect.top) / rect.height) * 100);
    setBoxes((prev) => prev.map((b, i) => (i === dragIndex ? { ...b, x, y } : b)));
  }

  // the dialog only opens for AWAITING_CONFIRM rows and never polls, so the run
  // never reaches DONE here - confirm hands off to the list + progress toast.
  const showAwaitingConfirm = status === "AWAITING_CONFIRM" && !uiError;
  const showError = (status === "ERROR" || uiError !== null) && !showAwaitingConfirm;
  const showLoading = !showAwaitingConfirm && !showError;

  return (
    <Modal isOpen onClose={onClose} title={t("mission.measurementFlow.title")}>
      <div className="flex flex-col gap-4" data-testid="measurement-flow-dialog">
        <p className="text-xs text-tv-text-secondary">{inspectionLabel}</p>

        {showLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-tv-accent" />
          </div>
        )}

        {showAwaitingConfirm && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-tv-text-primary">
              {t("mission.measurementFlow.confirmTitle")}
            </h3>
            <p className="text-xs text-tv-text-secondary">
              {boxes.length > 0
                ? t("mission.measurementFlow.confirmHint")
                : t("mission.measurementFlow.noBoxes")}
            </p>

            {previewUrl ? (
              <div
                ref={imageRef}
                className="relative w-full select-none overflow-hidden rounded-lg border border-tv-border bg-tv-bg"
                onPointerMove={(e) => moveBox(e.clientX, e.clientY)}
                onPointerUp={() => setDragIndex(null)}
                onPointerLeave={() => setDragIndex(null)}
                data-testid="measurement-preview"
              >
                <img
                  src={previewUrl}
                  alt={t("mission.measurementFlow.confirmTitle")}
                  className="block w-full"
                  draggable={false}
                />
                {boxes.map((box, i) => (
                  <button
                    type="button"
                    key={box.light_name}
                    onPointerDown={() => setDragIndex(i)}
                    aria-label={box.light_name}
                    data-testid={`light-box-${box.light_name}`}
                    className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-sm border-2 border-tv-accent bg-tv-accent/10"
                    style={{
                      left: `${box.x}%`,
                      top: `${box.y}%`,
                      width: `${box.size}%`,
                      aspectRatio: "1 / 1",
                      touchAction: "none",
                    }}
                  >
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-tv-accent">
                      {box.light_name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-tv-accent" />
              </div>
            )}

            <button
              type="button"
              disabled={confirming || !previewUrl}
              onClick={handleConfirm}
              data-testid="confirm-lights-button"
              className="mt-1 rounded-lg bg-tv-accent px-4 py-2 text-sm font-semibold text-tv-accent-text hover:opacity-90 disabled:opacity-50"
            >
              {confirming
                ? t("mission.measurementFlow.confirming")
                : t("mission.measurementFlow.confirmButton")}
            </button>
          </div>
        )}

        {showError && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertTriangle className="h-8 w-8 text-tv-error" />
            <h3 className="text-sm font-semibold text-tv-text-primary">
              {t("mission.measurementFlow.errorTitle")}
            </h3>
            <p className="text-xs text-tv-error">
              {uiError ?? errorMessage ?? t("mission.measurementFlow.startError")}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
