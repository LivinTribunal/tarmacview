import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, QrCode, Send } from "lucide-react";
import { dispatchMission } from "@/api/missions";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import type { MissionStatus } from "@/types/enums";
import Button from "@/components/common/Button";
import FieldLinkStatusChip from "./FieldLinkStatusChip";

export interface SendToDroneSectionProps {
  missionId: string;
  missionStatus: MissionStatus;
  linkStatus: FieldLinkStatusResponse | null;
  /** parent refetch - dispatch side-effects mission status VALIDATED -> EXPORTED. */
  onDispatched?: () => void;
  /** opens the field hub connection dialog (connect address + QR + CA cert). */
  onOpenFieldHub?: () => void;
}

type Feedback =
  | { kind: "success" }
  | { kind: "error"; message?: string }
  | { kind: "clamps" }
  | null;

function canDispatch(status: MissionStatus): boolean {
  return status === "VALIDATED" || status === "EXPORTED";
}

/** send-to-drone card - pushes the mission KMZ into the field hub's route library. */
export default function SendToDroneSection({
  missionId,
  missionStatus,
  linkStatus,
  onDispatched,
  onOpenFieldHub,
}: SendToDroneSectionProps) {
  const { t } = useTranslation();
  const [isDispatching, setIsDispatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const linkOnline =
    !!linkStatus?.hub_online && linkStatus.devices.some((d) => d.online);
  const statusAllows = canDispatch(missionStatus);
  // a pending clamp warning turns the button into an explicit "dispatch anyway"
  const acknowledgeClamps = feedback?.kind === "clamps";
  const disabled = !linkOnline || !statusAllows || isDispatching;

  async function handleDispatch() {
    setIsDispatching(true);
    setFeedback(null);
    try {
      const result = await dispatchMission(missionId, {
        acknowledge_altitude_clamps: acknowledgeClamps,
      });
      if (result.kind === "clamp_warning") {
        setFeedback({ kind: "clamps" });
        return;
      }
      setFeedback({ kind: "success" });
      onDispatched?.();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : typeof (detail as { message?: unknown })?.message === "string"
            ? ((detail as { message: string }).message)
            : undefined;
      setFeedback({ kind: "error", message });
    } finally {
      setIsDispatching(false);
    }
  }

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="send-to-drone-section"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border text-sm font-semibold text-tv-text-primary">
          {t("mission.sendToDrone.title")}
        </span>
        <div className="flex items-center gap-2">
          {onOpenFieldHub && (
            <button
              type="button"
              onClick={onOpenFieldHub}
              className="inline-flex items-center gap-1.5 rounded-full border border-tv-border px-2.5 py-1 text-xs font-semibold text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
              title={t("mission.fieldHub.open")}
              data-testid="open-field-hub-btn"
            >
              <QrCode className="h-3.5 w-3.5" />
              {t("mission.fieldHub.open")}
            </button>
          )}
          <FieldLinkStatusChip status={linkStatus} />
        </div>
      </div>
      <p className="text-xs text-tv-text-muted mb-3">
        {t("mission.sendToDrone.description")}
      </p>

      <Button
        variant="secondary"
        onClick={handleDispatch}
        disabled={disabled}
        title={
          !linkOnline
            ? t("mission.sendToDrone.linkOffline")
            : !statusAllows
              ? t("mission.sendToDrone.statusGate")
              : undefined
        }
        className="w-full flex items-center justify-center gap-2"
        data-testid="send-to-drone-btn"
      >
        {isDispatching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
        {isDispatching
          ? t("mission.sendToDrone.sending")
          : acknowledgeClamps
            ? t("mission.sendToDrone.sendAnyway")
            : t("mission.sendToDrone.send")}
      </Button>

      {feedback?.kind === "success" && (
        <p
          className="text-xs text-[var(--tv-success)] mt-2"
          data-testid="send-to-drone-success"
        >
          {t("mission.sendToDrone.success")}
        </p>
      )}
      {feedback?.kind === "error" && (
        <p
          className="text-xs text-[var(--tv-error)] mt-2"
          data-testid="send-to-drone-error"
        >
          {feedback.message ?? t("mission.sendToDrone.error")}
        </p>
      )}
      {feedback?.kind === "clamps" && (
        <p
          className="text-xs text-[var(--tv-warning)] mt-2"
          data-testid="send-to-drone-clamps"
        >
          {t("mission.sendToDrone.clampWarning")}
        </p>
      )}
    </div>
  );
}
