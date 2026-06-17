import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { MeasurementStatus } from "@/types/measurement";

// background tint per phase - terminal states get their solid status token,
// the in-progress phases a faint accent tint so they read as "active"
const STATUS_BG: Record<MeasurementStatus, string> = {
  QUEUED: "bg-tv-accent/10",
  FIRST_FRAME: "bg-tv-accent/10",
  PROCESSING: "bg-tv-accent/10",
  AWAITING_CONFIRM: "bg-tv-warning/20",
  DONE: "bg-[var(--tv-status-completed-bg)]",
  ERROR: "bg-[var(--tv-status-cancelled-bg)]",
};

const STATUS_TEXT: Record<MeasurementStatus, string> = {
  QUEUED: "text-tv-accent",
  FIRST_FRAME: "text-tv-accent",
  PROCESSING: "text-tv-accent",
  AWAITING_CONFIRM: "text-tv-warning",
  DONE: "text-[var(--tv-status-completed-text)]",
  ERROR: "text-[var(--tv-status-cancelled-text)]",
};

// only the phases where the worker is actively running spin
const SPINNING_STATUSES: MeasurementStatus[] = ["QUEUED", "FIRST_FRAME", "PROCESSING"];

// "sm" is the table/dropdown badge; "md" matches the navbar row pills (results header)
const SIZE_CLASS: Record<"sm" | "md", string> = {
  sm: "text-xs gap-1",
  md: "text-sm gap-1.5",
};

const SOLID_PAD: Record<"sm" | "md", string> = {
  sm: "rounded-full px-2.5 py-0.5",
  md: "rounded-full px-4 py-1.5",
};

const SPINNER_SIZE: Record<"sm" | "md", string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

interface MeasurementStatusChipProps {
  status: MeasurementStatus;
  size?: "sm" | "md";
  // "solid" is the standalone pill; "inline" drops the pill so the status reads
  // as colored text inside a surrounding bubble (the merged results-header rollup)
  variant?: "solid" | "inline";
  className?: string;
}

/** small themed pill carrying a measurement's current phase. */
export default function MeasurementStatusChip({
  status,
  size = "sm",
  variant = "solid",
  className = "",
}: MeasurementStatusChipProps) {
  const { t } = useTranslation();
  const spin = SPINNING_STATUSES.includes(status);
  const tone =
    variant === "solid"
      ? `${SOLID_PAD[size]} ${STATUS_BG[status]} ${STATUS_TEXT[status]}`
      : STATUS_TEXT[status];

  return (
    <span
      className={`inline-flex items-center font-semibold ${SIZE_CLASS[size]} ${tone} ${className}`}
      data-testid="measurement-status-chip"
    >
      {spin && <Loader2 className={`${SPINNER_SIZE[size]} animate-spin`} />}
      {t(`measurementsList.status.${status}`)}
    </span>
  );
}
