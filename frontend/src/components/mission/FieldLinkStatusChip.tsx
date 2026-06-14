import { useTranslation } from "react-i18next";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";

type LinkState = "noHub" | "offline" | "online";

const DOMAIN_AIRCRAFT = 0;

const DOT_CLASSES: Record<LinkState, string> = {
  noHub: "bg-[var(--tv-text-secondary)]",
  offline: "bg-[var(--tv-error)]",
  online: "bg-[var(--tv-success)]",
};

export interface FieldLinkStatusChipProps {
  /** poll result owned by the parent so chip + send-to-drone share one poll. */
  status: FieldLinkStatusResponse | null;
}

export default function FieldLinkStatusChip({ status }: FieldLinkStatusChipProps) {
  /** rc link state from the field hub - hidden until the first poll response. */
  const { t } = useTranslation();

  if (!status) return null;

  const onlineDevices = status.devices.filter((d) => d.online);
  const state: LinkState = !status.hub_online
    ? "noHub"
    : onlineDevices.length > 0
      ? "online"
      : "offline";

  // prefer the aircraft model in the label - the rc is the gateway, but the
  // operator cares which drone is attached
  const aircraft = onlineDevices.find((d) => d.domain === DOMAIN_AIRCRAFT);
  const model = (aircraft ?? onlineDevices[0])?.model_name ?? null;

  const label =
    state === "online"
      ? model
        ? t("mission.fieldLink.online", { model })
        : t("mission.fieldLink.onlineUnknownModel")
      : t(`mission.fieldLink.${state}`);

  return (
    <span
      data-testid="field-link-chip"
      data-state={state}
      className="inline-flex items-center gap-1.5 self-start rounded-full border border-[var(--tv-border)] bg-[var(--tv-surface)] px-2.5 py-0.5 text-xs font-semibold text-[var(--tv-text-secondary)]"
    >
      <span
        className={`h-2 w-2 rounded-full ${DOT_CLASSES[state]}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
