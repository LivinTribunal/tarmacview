import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MapPin } from "lucide-react";
import type { AirportSummary } from "@/types/auth";

interface UserAssignedAirportsPanelProps {
  assignedAirports: AirportSummary[];
  allAirports: AirportSummary[];
  onAddAirport: (airportId: string) => void;
  onRemoveAirport: (airportId: string) => void;
}

/** assigned-airports card with inline add/remove for the super-admin user detail. */
export default function UserAssignedAirportsPanel({
  assignedAirports,
  allAirports,
  onAddAirport,
  onRemoveAirport,
}: UserAssignedAirportsPanelProps) {
  const { t } = useTranslation();

  const unassigned = allAirports.filter(
    (a) => !assignedAirports.some((aa) => aa.id === a.id),
  );

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="user-assigned-airports"
    >
      <h4 className="text-sm font-semibold text-tv-text-primary mb-3 flex items-center gap-2">
        <MapPin className="h-4 w-4" />
        {t("admin.assignedAirports")}
        <span className="text-tv-text-muted">·</span>
        <span data-testid="assigned-airports-count">{assignedAirports.length}</span>
      </h4>

      <div className="space-y-1">
        {assignedAirports.length === 0 ? (
          <p className="text-xs text-tv-text-muted">{t("admin.noAirportsAssigned")}</p>
        ) : (
          assignedAirports.map((ap) => (
            <div
              key={ap.id}
              className="flex items-center justify-between rounded-xl bg-tv-bg px-3 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to={`/super-admin/airports/${ap.id}`}
                  className="text-sm text-tv-text-primary truncate hover:underline"
                >
                  {ap.name}
                </Link>
                <span className="text-xs text-tv-text-muted rounded-full bg-tv-surface-hover px-2 py-0.5">
                  {ap.icao_code}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveAirport(ap.id)}
                className="text-tv-text-muted hover:text-tv-error text-xs"
                aria-label={t("admin.removeAirportNamed", { name: ap.name })}
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>

      {unassigned.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) onAddAirport(e.target.value);
          }}
          className="mt-2 w-full rounded-full border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent"
          value=""
          data-testid="add-airport-select"
        >
          <option value="" disabled>
            {t("admin.addAirport")}
          </option>
          {unassigned.map((ap) => (
            <option key={ap.id} value={ap.id}>
              {ap.name} ({ap.icao_code})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
