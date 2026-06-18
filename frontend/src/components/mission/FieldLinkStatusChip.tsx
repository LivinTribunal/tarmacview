import { useTranslation } from "react-i18next";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";

type RcState = "noHub" | "offline" | "online";
type TelemetryState = "on" | "off";

const RC_DOT: Record<RcState, string> = {
  noHub: "bg-[var(--tv-text-secondary)]",
  offline: "bg-[var(--tv-error)]",
  online: "bg-[var(--tv-success)]",
};

const TELEMETRY_DOT: Record<TelemetryState, string> = {
  on: "bg-[var(--tv-success)]",
  off: "bg-[var(--tv-text-secondary)]",
};

const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--tv-border)] bg-[var(--tv-surface)] px-2.5 py-0.5 text-xs font-semibold text-[var(--tv-text-secondary)]";

export interface FieldLinkStatusChipProps {
  /** poll result owned by the parent so chip + send-to-drone share one poll. */
  status: FieldLinkStatusResponse | null;
}

export default function FieldLinkStatusChip({ status }: FieldLinkStatusChipProps) {
  /** two glance signals: the RC's http link and live drone telemetry. */
  const { t } = useTranslation();

  if (!status) return null;

  // RC: pilot's http session with the hub - connected once pilot logs in and
  // can receive missions, independent of any drone telemetry.
  const rcState: RcState = !status.hub_online
    ? "noHub"
    : status.rc_connected
      ? "online"
      : "offline";
  const rcLabel =
    rcState === "noHub"
      ? t("mission.fieldLink.noHub")
      : rcState === "online"
        ? t("mission.fieldLink.rcConnected")
        : t("mission.fieldLink.rcOffline");

  // Telemetry: a drone is actually live on the broker. distinct from the hub's
  // own broker link (shown separately in the field-hub dialog).
  const telemetryState: TelemetryState = status.devices.some((d) => d.online) ? "on" : "off";
  const telemetryLabel =
    telemetryState === "on"
      ? t("mission.fieldLink.telemetryOnline")
      : t("mission.fieldLink.telemetryOffline");

  return (
    <span
      data-testid="field-link-chip"
      className="inline-flex flex-wrap items-center justify-end gap-2"
    >
      <span data-testid="field-link-rc" data-state={rcState} className={PILL_CLASS}>
        <span className={`h-2 w-2 rounded-full ${RC_DOT[rcState]}`} aria-hidden="true" />
        {rcLabel}
      </span>
      <span data-testid="field-link-telemetry" data-state={telemetryState} className={PILL_CLASS}>
        <span
          className={`h-2 w-2 rounded-full ${TELEMETRY_DOT[telemetryState]}`}
          aria-hidden="true"
        />
        {telemetryLabel}
      </span>
    </span>
  );
}
