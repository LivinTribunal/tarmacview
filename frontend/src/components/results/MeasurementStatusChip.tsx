import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { MeasurementStatus } from "@/types/measurement";

// terminal states render as plain solid pills like every other status tag;
// the in-progress phases keep a faint accent tint + spinner to read as "active"
const STATUS_TONE: Record<MeasurementStatus, string> = {
  QUEUED: "bg-tv-accent/10 text-tv-accent",
  FIRST_FRAME: "bg-tv-accent/10 text-tv-accent",
  PROCESSING: "bg-tv-accent/10 text-tv-accent",
  AWAITING_CONFIRM: "bg-tv-warning/20 text-tv-warning",
  DONE: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  ERROR: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
};

// only the phases where the worker is actively running spin
const SPINNING_STATUSES: MeasurementStatus[] = ["QUEUED", "FIRST_FRAME", "PROCESSING"];

interface MeasurementStatusChipProps {
  status: MeasurementStatus;
  className?: string;
}

/** small themed pill carrying a measurement's current phase. */
export default function MeasurementStatusChip({
  status,
  className = "",
}: MeasurementStatusChipProps) {
  const { t } = useTranslation();
  const spin = SPINNING_STATUSES.includes(status);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status]} ${className}`}
      data-testid="measurement-status-chip"
    >
      {spin && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {t(`measurementsList.status.${status}`)}
    </span>
  );
}
