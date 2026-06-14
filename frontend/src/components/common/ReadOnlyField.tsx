import type { ReactNode } from "react";
import InfoHint from "./InfoHint";

interface ReadOnlyFieldProps {
  label: string;
  value: ReactNode;
  testId?: string;
  hint?: string;
}

/** read-only display: label + pill matching input styling but on bg-tv-surface to signal non-interactive. */
export default function ReadOnlyField({ label, value, testId, hint }: ReadOnlyFieldProps) {
  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
        <span>{label}</span>
        {hint && <InfoHint text={hint} label={label} />}
      </label>
      <div
        aria-readonly="true"
        className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-surface text-tv-text-primary"
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}
