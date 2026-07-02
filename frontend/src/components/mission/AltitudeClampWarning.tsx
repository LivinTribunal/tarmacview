import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { datumHeightLabel } from "@/utils/altitudeLabel";
import type { AltitudeClamp } from "@/types/export";

interface AltitudeClampWarningProps {
  clamps: AltitudeClamp[];
  acknowledged: boolean;
  onAcknowledgedChange: (next: boolean) => void;
  onDismiss?: () => void;
}

/** below-takeoff dji altitude clamp surface + operator ack checkbox. */
export default function AltitudeClampWarning({
  clamps,
  acknowledged,
  onAcknowledgedChange,
  onDismiss,
}: AltitudeClampWarningProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col gap-2 px-3 py-3 rounded-xl border border-tv-warning bg-tv-warning/10"
      data-testid="altitude-clamp-warning"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-tv-warning">
            {t("mission.validationExportPage.altitudeClamp.title")}
          </p>
          <p className="text-xs text-tv-text-secondary mt-1">
            {t("mission.validationExportPage.altitudeClamp.body", {
              count: clamps.length,
            })}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-tv-text-muted hover:text-tv-text-primary"
            aria-label={t("common.cancel")}
            data-testid="altitude-clamp-dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="altitude-clamp-table">
          <thead>
            <tr className="text-left text-tv-text-muted">
              <th className="font-medium pr-2 py-1">
                {t("mission.validationExportPage.altitudeClamp.waypoint")}
              </th>
              <th className="font-medium pr-2 py-1">
                {t("mission.validationExportPage.altitudeClamp.intended")}
              </th>
              <th className="font-medium pr-2 py-1">
                {t("mission.validationExportPage.altitudeClamp.clamped")}
              </th>
            </tr>
          </thead>
          <tbody>
            {clamps.map((c) => (
              <tr
                key={`${c.waypoint_index}-${c.intended_alt}`}
                className="border-t border-tv-border/50"
                data-testid={`altitude-clamp-row-${c.waypoint_index}`}
              >
                <td className="pr-2 py-1 text-tv-text-primary">#{c.waypoint_index}</td>
                <td className="pr-2 py-1 text-tv-text-primary">
                  {datumHeightLabel(c.intended_alt, t, "MSL")}
                </td>
                <td className="pr-2 py-1 text-tv-text-primary">
                  {datumHeightLabel(c.clamped_alt, t, "MSL")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
          className="mt-0.5 accent-[var(--tv-accent)]"
          data-testid="altitude-clamp-ack"
        />
        <span className="text-xs text-tv-text-primary">
          {t("mission.validationExportPage.altitudeClamp.acknowledge")}
        </span>
      </label>
    </div>
  );
}
