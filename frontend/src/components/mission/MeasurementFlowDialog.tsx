import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Modal from "@/components/common/Modal";
import { isAxiosError } from "@/api/client";
import {
  confirmMeasurementLights,
  createMeasurement,
  getMeasurementPreview,
  getMeasurementStatus,
} from "@/api/measurements";
import type { LightBox, MeasurementStatus } from "@/types/measurement";

interface MeasurementFlowDialogProps {
  inspectionId: string;
  inspectionLabel: string;
  onClose: () => void;
}

const POLL_INTERVAL_MS = 3000;
const ACTIVE_STATUSES: MeasurementStatus[] = ["QUEUED", "FIRST_FRAME", "PROCESSING"];

/** pull a human message off an axios error, falling back to an i18n string. */
function apiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
      return detail.message;
    }
  }
  return fallback;
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** drives one measurement run end to end: start -> poll -> confirm boxes -> poll -> results. */
export default function MeasurementFlowDialog({
  inspectionId,
  inspectionLabel,
  onClose,
}: MeasurementFlowDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [measurementId, setMeasurementId] = useState<string | null>(null);
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

  // start the run once - createMeasurement reads the inspection's uploaded media server-side
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const m = await createMeasurement(inspectionId);
        if (!mountedRef.current) return;
        setMeasurementId(m.id);
        setStatus(m.status);
      } catch (err) {
        if (!mountedRef.current) return;
        setUiError(apiErrorMessage(err, t("mission.measurementFlow.startError")));
      }
    })();
  }, [inspectionId, t]);

  // poll while the worker is busy; stops on AWAITING_CONFIRM / DONE / ERROR
  useEffect(() => {
    if (!measurementId || status === null || !ACTIVE_STATUSES.includes(status)) return;
    let cancelled = false;
    const handle = setInterval(async () => {
      try {
        const s = await getMeasurementStatus(measurementId);
        if (cancelled) return;
        setStatus(s.status);
        if (s.status === "ERROR") setErrorMessage(s.error_message);
      } catch {
        // transient poll failure - keep polling
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [measurementId, status]);

  // fetch the first frame + detected boxes once the worker pauses for confirmation
  useEffect(() => {
    if (status !== "AWAITING_CONFIRM" || !measurementId || previewLoaded) return;
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

  async function handleConfirm() {
    if (!measurementId) return;
    setConfirming(true);
    setUiError(null);
    try {
      const m = await confirmMeasurementLights(measurementId, boxes);
      if (!mountedRef.current) return;
      setStatus(m.status);
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

  const phaseLabel = (() => {
    if (uiError) return null;
    if (measurementId === null) return t("mission.measurementFlow.starting");
    if (status === "QUEUED") return t("mission.measurementFlow.phase.queued");
    if (status === "FIRST_FRAME") return t("mission.measurementFlow.phase.firstFrame");
    if (status === "PROCESSING") return t("mission.measurementFlow.phase.processing");
    return null;
  })();

  const showAwaitingConfirm = status === "AWAITING_CONFIRM" && !uiError;
  const showDone = status === "DONE" && !uiError;
  const showError = (status === "ERROR" || uiError !== null) && !showAwaitingConfirm;

  return (
    <Modal isOpen onClose={onClose} title={t("mission.measurementFlow.title")}>
      <div className="flex flex-col gap-4" data-testid="measurement-flow-dialog">
        <p className="text-xs text-tv-text-secondary">{inspectionLabel}</p>

        {phaseLabel && (
          <div className="flex items-center gap-2 py-6 justify-center text-sm text-tv-text-secondary">
            <Loader2 className="h-5 w-5 animate-spin text-tv-accent" />
            {phaseLabel}
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

        {showDone && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-tv-success" />
            <h3 className="text-sm font-semibold text-tv-text-primary">
              {t("mission.measurementFlow.doneTitle")}
            </h3>
            <p className="text-xs text-tv-text-secondary">
              {t("mission.measurementFlow.doneHint")}
            </p>
            <button
              type="button"
              onClick={() =>
                measurementId &&
                navigate(`/operator-center/measurements/${measurementId}/results`)
              }
              data-testid="view-results-button"
              className="rounded-lg bg-tv-accent px-4 py-2 text-sm font-semibold text-tv-accent-text hover:opacity-90"
            >
              {t("mission.measurementFlow.viewResults")}
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
