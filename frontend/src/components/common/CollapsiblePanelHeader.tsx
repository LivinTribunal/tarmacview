import { ChevronDown } from "lucide-react";

interface CollapsiblePanelHeaderProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

/** title-pill + count-badge + rotating chevron header for collapsible map panels. */
export default function CollapsiblePanelHeader({
  title,
  count,
  collapsed,
  onToggle,
}: CollapsiblePanelHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between px-3 py-2"
    >
      <span className="rounded-full px-3 py-1 bg-tv-surface border border-tv-border text-xs font-semibold text-tv-text-primary">
        {title}
      </span>
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1.5 text-[10px] font-semibold bg-tv-accent text-tv-accent-text">
          {count}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-tv-text-muted transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </div>
    </button>
  );
}
