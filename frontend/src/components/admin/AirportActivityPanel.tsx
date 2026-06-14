import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AuditLogEntry } from "@/types/admin";
import { actionBadgeStyle } from "@/pages/super-admin/badgeStyles";

interface AirportActivityPanelProps {
  activity: AuditLogEntry[];
  airportId: string;
  formatTs: (ts: string) => string;
}

/** recent-activity card for the super-admin airport detail page. */
export default function AirportActivityPanel({
  activity,
  airportId,
  formatTs,
}: AirportActivityPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="airport-activity-panel"
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-tv-text-primary">
          {t("admin.recentActivity")}
        </h4>
        <Link
          to={`/super-admin/audit-log?airport_id=${airportId}`}
          className="text-xs text-tv-text-secondary hover:text-tv-text-primary"
          data-testid="view-all-link"
        >
          {t("admin.viewAll")}
        </Link>
      </div>

      {activity.length === 0 ? (
        <p className="text-xs text-tv-text-muted">
          {t("admin.airportDetail.noActivity")}
        </p>
      ) : (
        <div
          className="space-y-2 max-h-[400px] overflow-y-auto"
          data-testid="airport-activity-list"
        >
          {activity.map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-xs">
              <span
                className="rounded-full px-1.5 py-0.5 font-semibold flex-shrink-0 mt-0.5"
                style={actionBadgeStyle(log.action)}
                title={log.action}
              >
                {t(`admin.audit.actions.${log.action}`, log.action)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-tv-text-secondary truncate">
                  {log.user_email ?? "—"}
                  {log.entity_type ? ` · ${log.entity_type}` : ""}
                  {log.entity_name ? `: ${log.entity_name}` : ""}
                </p>
                <p className="text-tv-text-muted" title={formatTs(log.timestamp)}>
                  {formatTs(log.timestamp)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
