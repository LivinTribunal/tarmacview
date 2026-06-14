import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { AirportAdminResponse } from "@/types/admin";
import { ACTION_BADGE, ENTITY_TYPE_BADGE } from "@/pages/super-admin/badgeStyles";

const ACTION_OPTIONS = [
  "LOGIN",
  "LOGOUT",
  "CREATE",
  "UPDATE",
  "DELETE",
  "INVITE_USER",
  "DEACTIVATE_USER",
  "ASSIGN_AIRPORT",
  "SYSTEM_SETTING_CHANGE",
];

const ENTITY_TYPE_OPTIONS = [
  "User",
  "Airport",
  "Mission",
  "DroneProfile",
  "InspectionTemplate",
  "SystemSettings",
];

interface AuditLogFilterBarProps {
  airportIdFilter: string | null;
  scopedAirport: AirportAdminResponse | null;
  onClearAirportFilter: () => void;
  actionFilter: string | null;
  onToggleAction: (value: string) => void;
  entityTypeFilter: string | null;
  onToggleEntityType: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
}

/** scope chip + action/entity-type pills + date range for the super-admin audit log. */
export default function AuditLogFilterBar({
  airportIdFilter,
  scopedAirport,
  onClearAirportFilter,
  actionFilter,
  onToggleAction,
  entityTypeFilter,
  onToggleEntityType,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
}: AuditLogFilterBarProps) {
  const { t } = useTranslation();

  return (
    <>
      {airportIdFilter && (
        <div
          className="flex items-center gap-2 mb-3"
          data-testid="airport-scope-chip"
        >
          <span className="rounded-full bg-tv-surface border border-tv-border px-3 py-1 text-xs font-semibold text-tv-text-primary flex items-center gap-2">
            {t("admin.scopedToAirport", {
              name: scopedAirport
                ? `${scopedAirport.name} (${scopedAirport.icao_code})`
                : airportIdFilter,
            })}
            <button
              type="button"
              onClick={onClearAirportFilter}
              className="text-tv-text-muted hover:text-tv-error"
              aria-label={t("admin.clearFilter")}
              data-testid="airport-scope-clear"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {/* filter row 1 - action pills */}
      <div className="flex items-center w-full max-w-6xl mb-2 rounded-full border border-tv-border bg-tv-surface px-3 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ACTION_OPTIONS.map((action) => {
            const isActive = actionFilter === action;
            const dim = actionFilter !== null && !isActive;
            return (
              <button
                key={action}
                type="button"
                onClick={() => onToggleAction(action)}
                style={ACTION_BADGE[action]}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-opacity${
                  dim ? " opacity-40" : ""
                }`}
                data-testid={`action-pill-${action}`}
                aria-pressed={isActive}
              >
                {action}
              </button>
            );
          })}
        </div>
      </div>

      {/* filter row 2 - entity type pills + date range */}
      <div className="flex items-center w-full max-w-6xl mb-4 rounded-full border border-tv-border bg-tv-surface px-3 py-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ENTITY_TYPE_OPTIONS.map((type) => {
            const isActive = entityTypeFilter === type;
            const dim = entityTypeFilter !== null && !isActive;
            return (
              <button
                key={type}
                type="button"
                onClick={() => onToggleEntityType(type)}
                style={ENTITY_TYPE_BADGE[type]}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-opacity${
                  dim ? " opacity-40" : ""
                }`}
                data-testid={`entity-type-pill-${type}`}
                aria-pressed={isActive}
              >
                {type}
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-tv-border mx-3" />

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1 text-xs text-tv-text-secondary">
            {t("common.filters.from")}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs text-tv-text-primary focus:outline-none focus:border-tv-accent"
              data-testid="date-from"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-tv-text-secondary">
            {t("common.filters.to")}
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs text-tv-text-primary focus:outline-none focus:border-tv-accent"
              data-testid="date-to"
            />
          </label>
        </div>
      </div>
    </>
  );
}
