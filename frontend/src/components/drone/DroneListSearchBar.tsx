import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchBar } from "@/components/common/ListPageLayout";

interface DroneListSearchBarProps {
  search: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  manufacturerFilter: string;
  onManufacturerChange: (value: string) => void;
  manufacturers: string[];
  children?: ReactNode;
}

/** shared drone-list search bar with manufacturer filter and a trailing action slot. */
export default function DroneListSearchBar({
  search,
  onSearchChange,
  manufacturerFilter,
  onManufacturerChange,
  manufacturers,
  children,
}: DroneListSearchBarProps) {
  const { t } = useTranslation();

  return (
    <SearchBar
      value={search}
      onChange={onSearchChange}
      placeholder={t("coordinator.drones.searchPlaceholder")}
      testId="drone-search"
    >
      <select
        value={manufacturerFilter}
        onChange={(e) => onManufacturerChange(e.target.value)}
        className="rounded-full border border-tv-border bg-tv-surface px-4 h-10 text-sm
          text-tv-text-primary focus:outline-none focus:border-tv-accent"
        data-testid="manufacturer-filter"
      >
        <option value="">{t("coordinator.drones.allManufacturers")}</option>
        {manufacturers.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {children}
    </SearchBar>
  );
}
