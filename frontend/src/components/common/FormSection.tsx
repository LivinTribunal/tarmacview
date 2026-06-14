import type { ReactNode } from "react";
import InfoHint from "./InfoHint";

interface FormSectionProps {
  title: string;
  children: ReactNode;
  testId?: string;
  // optional right-aligned content rendered next to the heading
  meta?: ReactNode;
  // optional one-line help text shown via an info icon next to the title
  hint?: string;
}

/** form group with semibold heading + thin top rule, used to break long config forms into clusters. */
export default function FormSection({ title, children, testId, meta, hint }: FormSectionProps) {
  return (
    <section
      className="pt-3 border-t border-tv-border first:border-t-0 first:pt-0"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-tv-text-primary">
          <span>{title}</span>
          {hint && <InfoHint text={hint} label={title} />}
        </h3>
        {meta}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
