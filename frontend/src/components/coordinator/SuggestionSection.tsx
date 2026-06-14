import { useTranslation } from "react-i18next";

interface SuggestionSectionProps<T extends { checked: boolean }> {
  title: string;
  count: number;
  items: T[];
  expanded: boolean;
  testIdPrefix: string;
  keyPrefix: string;
  onToggleSection: () => void;
  onSetSectionChecked: (checked: boolean) => void;
  onToggleItem: (index: number) => void;
  renderItem: (item: T) => React.ReactNode;
}

/** collapsible checkbox list for one openaip suggestion category. */
export default function SuggestionSection<T extends { checked: boolean }>({
  title,
  count,
  items,
  expanded,
  testIdPrefix,
  keyPrefix,
  onToggleSection,
  onSetSectionChecked,
  onToggleItem,
  renderItem,
}: SuggestionSectionProps<T>) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onToggleSection}
          className="text-xs font-semibold text-tv-text-secondary flex items-center gap-1 text-left"
        >
          <span>{expanded ? "▾" : "▸"}</span>
          <span>
            {title} ({count})
          </span>
        </button>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => onSetSectionChecked(true)}
            className="text-tv-accent hover:underline"
          >
            {t("coordinator.createAirport.lookup.all")}
          </button>
          <span className="text-tv-text-secondary">|</span>
          <button
            type="button"
            onClick={() => onSetSectionChecked(false)}
            className="text-tv-accent hover:underline"
          >
            {t("coordinator.createAirport.lookup.none")}
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="text-xs flex flex-col gap-1 mt-1">
          {items.map((item, i) => (
            <li key={`${keyPrefix}-${i}`} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => onToggleItem(i)}
                aria-label={title}
                data-testid={`${testIdPrefix}-${i}`}
              />
              <span>{renderItem(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
