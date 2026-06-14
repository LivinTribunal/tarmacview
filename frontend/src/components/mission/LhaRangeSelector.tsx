import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { LhaSelectionRangeParams } from "@/types/mission";

interface LhaRangeSelectorProps {
  params: LhaSelectionRangeParams;
  onChange: (next: LhaSelectionRangeParams) => void;
  disabled?: boolean;
}

function parseIntOrNull(value: string): number | null {
  if (value === "") return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export default function LhaRangeSelector({
  params,
  onChange,
  disabled = false,
}: LhaRangeSelectorProps) {
  const { t } = useTranslation();
  const fromId = useId();
  const toId = useId();
  const invalid =
    params.from != null && params.to != null && params.from > params.to;

  return (
    <div className="mt-2" data-testid="lha-range-selector">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label
            htmlFor={fromId}
            className="block text-xs font-medium mb-1 text-tv-text-secondary"
          >
            {t("mission.config.lhaSelection.rangeFrom")}
          </label>
          <input
            id={fromId}
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={params.from ?? ""}
            onChange={(e) =>
              onChange({ ...params, from: parseIntOrNull(e.target.value) })
            }
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50"
            data-testid="lha-range-from"
          />
        </div>
        <div className="flex-1">
          <label
            htmlFor={toId}
            className="block text-xs font-medium mb-1 text-tv-text-secondary"
          >
            {t("mission.config.lhaSelection.rangeTo")}
          </label>
          <input
            id={toId}
            type="number"
            min={1}
            step={1}
            disabled={disabled}
            value={params.to ?? ""}
            onChange={(e) =>
              onChange({ ...params, to: parseIntOrNull(e.target.value) })
            }
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50"
            data-testid="lha-range-to"
          />
        </div>
      </div>
      {invalid && (
        <p
          className="mt-1 text-xs text-tv-warning"
          data-testid="lha-range-invalid"
        >
          {t("mission.config.lhaSelection.rangeInvalid")}
        </p>
      )}
    </div>
  );
}
