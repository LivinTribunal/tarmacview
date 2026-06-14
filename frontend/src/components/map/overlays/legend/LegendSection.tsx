import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LegendItem } from "./legendEntries";
import { SectionChevron, Swatch } from "./Swatch";

interface LegendSectionProps {
  title: string;
  items: LegendItem[];
  defaultOpen?: boolean;
}

/** collapsible legend section with colored swatches. */
export function LegendSection({ title, items, defaultOpen = true }: LegendSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between mb-1 text-left"
      >
        <p className="text-[10px] font-medium uppercase text-tv-text-muted text-left">
          {title}
        </p>
        <SectionChevron open={open} />
      </button>
      {open &&
        items.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-2 py-0.5 text-xs text-tv-text-secondary"
          >
            <Swatch item={item} />
            {t(item.i18nKey)}
          </div>
        ))}
    </div>
  );
}
