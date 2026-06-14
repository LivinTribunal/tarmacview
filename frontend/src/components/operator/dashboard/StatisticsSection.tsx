import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Clock, CheckCircle, TrendingUp } from "lucide-react";
import type { MissionResponse } from "@/types/mission";
import CollapsibleSection from "@/components/common/CollapsibleSection";
import { formatDuration } from "@/utils/format";

// stat card definitions
const STAT_CARDS = [
  { key: "totalMissions", icon: FileText, color: "var(--tv-accent)" },
  { key: "avgDuration", icon: Clock, color: "var(--tv-info)" },
  { key: "inspectionsDone", icon: CheckCircle, color: "var(--tv-inspection-4)" },
  { key: "successRate", icon: TrendingUp, color: "var(--tv-accent)" },
] as const;

export default function StatisticsSection({ missions }: { missions: MissionResponse[] }) {
  const { t } = useTranslation();

  const avgDuration = useMemo(() => {
    const withDuration = missions.filter((m) => m.estimated_duration != null);
    if (withDuration.length === 0) return "—";
    const avg = withDuration.reduce((sum, m) => sum + m.estimated_duration!, 0) / withDuration.length;
    return formatDuration(avg);
  }, [missions]);

  const inspectionsDone = useMemo(() => {
    return String(missions.filter((m) => m.status === "COMPLETED").reduce((sum, m) => sum + m.inspection_count, 0));
  }, [missions]);

  const successRate = useMemo(() => {
    const nonDraft = missions.filter((m) => m.status !== "DRAFT");
    if (nonDraft.length === 0) return "—";
    const completed = nonDraft.filter((m) => m.status === "COMPLETED").length;
    return `${Math.round((completed / nonDraft.length) * 100)}%`;
  }, [missions]);

  const stats = [
    { ...STAT_CARDS[0], value: String(missions.length), label: t("dashboard.totalMissions") },
    { ...STAT_CARDS[1], value: avgDuration, label: t("dashboard.avgDuration") },
    { ...STAT_CARDS[2], value: inspectionsDone, label: t("dashboard.inspectionsDone") },
    { ...STAT_CARDS[3], value: successRate, label: t("dashboard.successRate") },
  ];

  return (
    <CollapsibleSection title={t("dashboard.statistics")}>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.key}
            className="rounded-xl border p-3"
            style={{
              backgroundColor: "var(--tv-surface)",
              borderColor: "var(--tv-border)",
            }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center mb-2"
              style={{ backgroundColor: stat.color + "1a" }}
            >
              <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
            </div>
            <p className="text-2xl font-bold text-tv-text-primary">{stat.value}</p>
            <p className="text-xs text-tv-text-secondary">{stat.label}</p>
          </div>
        ))}
      </div>
    </CollapsibleSection>
  );
}
