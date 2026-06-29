import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, HelpCircle } from "lucide-react";
import { ResponsiveContainer } from "recharts";

interface ChartShellProps {
  title: string;
  // collapsible explanation note describing what the chart shows
  explanation: string;
  hasData: boolean;
  height?: number;
  // optional pass/fail badge rendered at the right of the header
  badge?: ReactNode;
  // extra controls (e.g. a unit selector) rendered above the chart body
  toolbar?: ReactNode;
  testId?: string;
  // a single recharts element
  children: ReactNode;
}

/** card wrapper for a results chart - title, collapsible explanation, empty state. */
export default function ChartShell({
  title,
  explanation,
  hasData,
  height = 320,
  badge,
  toolbar,
  testId,
  children,
}: ChartShellProps) {
  const { t } = useTranslation();
  const [showNote, setShowNote] = useState(false);

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-tv-text-primary">{title}</h3>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>

      <button
        type="button"
        onClick={() => setShowNote((prev) => !prev)}
        aria-expanded={showNote}
        className="flex items-center gap-1 text-xs text-tv-text-secondary hover:text-tv-text-primary transition-colors"
        data-testid={testId ? `${testId}-explain-toggle` : undefined}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {t("results.charts.whatsThis")}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showNote ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {showNote && (
        <p className="mt-1 text-[11px] leading-snug text-tv-text-muted">
          {explanation}
        </p>
      )}

      {toolbar && <div className="mt-3">{toolbar}</div>}

      <div className="mt-3">
        {hasData ? (
          <ResponsiveContainer width="100%" height={height}>
            {children as React.ReactElement}
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-tv-text-muted py-8 text-center">
            {t("results.noData")}
          </p>
        )}
      </div>
    </div>
  );
}
