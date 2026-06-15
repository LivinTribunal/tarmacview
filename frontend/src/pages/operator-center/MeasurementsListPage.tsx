import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import { listAirportMeasurements } from "@/api/measurements";
import type { MeasurementListItem } from "@/types/measurement";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import MeasurementFlowDialog from "@/components/mission/MeasurementFlowDialog";
import { formatDate } from "@/utils/format";

const ACTIVE_STATUSES: MeasurementListItem["status"][] = [
  "QUEUED",
  "FIRST_FRAME",
  "PROCESSING",
];

/** a measurement to resume in the flow dialog (confirm-later / watch progress). */
interface ResumeTarget {
  measurementId: string;
  inspectionId: string;
  label: string;
}

/** rows for one mission, in the contiguous order the backend already grouped them. */
interface MissionGroup {
  missionId: string;
  missionName: string;
  rows: MeasurementListItem[];
}

/** fold the already-grouped rows into per-mission sections, preserving order. */
function groupByMission(rows: MeasurementListItem[]): MissionGroup[] {
  const groups: MissionGroup[] = [];
  const byId = new Map<string, MissionGroup>();
  for (const row of rows) {
    let group = byId.get(row.mission_id);
    if (!group) {
      group = {
        missionId: row.mission_id,
        missionName: row.mission_name,
        rows: [],
      };
      byId.set(row.mission_id, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/** airport-scoped measurements list - the results entry point for the operator. */
export default function MeasurementsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAirport } = useAirport();

  const [rows, setRows] = useState<MeasurementListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);

  const airportId = selectedAirport?.id ?? null;

  const fetchRows = useCallback(() => {
    if (!airportId) return;
    setLoading(true);
    setError(false);
    listAirportMeasurements(airportId)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [airportId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  function inspectionLabel(row: MeasurementListItem): string {
    return t("measurementsList.inspectionLabel", {
      order: row.inspection_sequence_order,
      method: t(`map.inspectionMethod.${row.inspection_method}`, row.inspection_method),
    });
  }

  function openResume(row: MeasurementListItem) {
    setResumeTarget({
      measurementId: row.id,
      inspectionId: row.inspection_id,
      label: inspectionLabel(row),
    });
  }

  // resuming an AWAITING_CONFIRM run may finish it; refresh on close
  function handleResumeClose() {
    setResumeTarget(null);
    fetchRows();
  }

  if (!selectedAirport) {
    return (
      <div
        className="flex h-full items-center justify-center bg-tv-bg"
        data-testid="measurements-no-airport"
      >
        <p className="text-sm text-tv-text-muted">
          {t("measurementsList.noAirport")}
        </p>
      </div>
    );
  }

  const groups = groupByMission(rows);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-auto p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-tv-text-primary">
          {t("measurementsList.title")}
        </h1>
        <p className="text-sm text-tv-text-secondary">
          {t("measurementsList.subtitle", { airport: selectedAirport.name })}
        </p>
      </header>

      {loading && (
        <div
          className="flex items-center justify-center py-12 text-tv-text-secondary"
          data-testid="measurements-loading"
        >
          <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
        </div>
      )}

      {!loading && error && (
        <Card className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-7 w-7 text-tv-error" />
          <p className="text-sm text-tv-error">{t("measurementsList.loadError")}</p>
          <Button variant="secondary" onClick={fetchRows}>
            {t("measurementsList.retry")}
          </Button>
        </Card>
      )}

      {!loading && !error && groups.length === 0 && (
        <Card className="py-8 text-center">
          <p
            className="text-sm text-tv-text-muted"
            data-testid="measurements-empty"
          >
            {t("measurementsList.empty")}
          </p>
        </Card>
      )}

      {!loading && !error && groups.length > 0 && (
        <div className="flex flex-col gap-6" data-testid="measurements-list">
          {groups.map((group) => (
            <section
              key={group.missionId}
              className="flex flex-col gap-3"
              data-testid={`mission-group-${group.missionId}`}
            >
              <h2 className="text-sm font-semibold text-tv-text-secondary">
                {t("measurementsList.missionGroup", { mission: group.missionName })}
              </h2>
              <ul className="flex flex-col gap-3">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <MeasurementRow
                      row={row}
                      label={inspectionLabel(row)}
                      onViewResults={() =>
                        navigate(`/operator-center/measurements/${row.id}/results`)
                      }
                      onResume={() => openResume(row)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {resumeTarget && (
        <MeasurementFlowDialog
          inspectionId={resumeTarget.inspectionId}
          inspectionLabel={resumeTarget.label}
          resumeMeasurementId={resumeTarget.measurementId}
          onClose={handleResumeClose}
        />
      )}
    </div>
  );
}

interface MeasurementRowProps {
  row: MeasurementListItem;
  label: string;
  onViewResults: () => void;
  onResume: () => void;
}

/** one measurement row - status chip plus the action that fits its phase. */
function MeasurementRow({
  row,
  label,
  onViewResults,
  onResume,
}: MeasurementRowProps) {
  const { t } = useTranslation();
  const isActive = ACTIVE_STATUSES.includes(row.status);

  return (
    <Card className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-tv-text-primary">{label}</span>
        <div className="flex items-center gap-2">
          <StatusChip status={row.status} />
          {row.created_at && (
            <span className="text-xs text-tv-text-muted">
              {formatDate(row.created_at)}
            </span>
          )}
        </div>
        {row.status === "DONE" && (
          <span className="text-xs text-tv-text-secondary">
            {t("measurementsList.passFail", {
              pass: row.pass_count,
              fail: row.fail_count,
            })}
          </span>
        )}
        {row.status === "ERROR" && row.error_message && (
          <span className="text-xs text-tv-error" data-testid={`error-${row.id}`}>
            {row.error_message}
          </span>
        )}
      </div>

      <div className="flex-shrink-0">
        {row.status === "DONE" && (
          <Button onClick={onViewResults} data-testid={`view-results-${row.id}`}>
            {t("measurementsList.viewResults")}
          </Button>
        )}
        {row.status === "AWAITING_CONFIRM" && (
          <Button onClick={onResume} data-testid={`review-${row.id}`}>
            {t("measurementsList.review")}
          </Button>
        )}
        {isActive && (
          <Button
            variant="secondary"
            onClick={onResume}
            data-testid={`watch-${row.id}`}
          >
            {t("measurementsList.watch")}
          </Button>
        )}
      </div>
    </Card>
  );
}

interface StatusChipProps {
  status: MeasurementListItem["status"];
}

/** small themed pill carrying the measurement's current phase. */
function StatusChip({ status }: StatusChipProps) {
  const { t } = useTranslation();
  const tone: Record<MeasurementListItem["status"], string> = {
    QUEUED: "bg-tv-accent/10 text-tv-accent",
    FIRST_FRAME: "bg-tv-accent/10 text-tv-accent",
    PROCESSING: "bg-tv-accent/10 text-tv-accent",
    AWAITING_CONFIRM: "bg-tv-warning/15 text-tv-warning",
    DONE: "bg-tv-success/15 text-tv-success",
    ERROR: "bg-tv-error/15 text-tv-error",
  };
  const Icon =
    status === "DONE"
      ? CheckCircle2
      : status === "ERROR"
        ? AlertTriangle
        : status === "AWAITING_CONFIRM"
          ? ClipboardCheck
          : Loader2;
  const spin = status !== "DONE" && status !== "ERROR" && status !== "AWAITING_CONFIRM";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone[status]}`}
    >
      <Icon className={`h-3.5 w-3.5 ${spin ? "animate-spin" : ""}`} />
      {t(`measurementsList.status.${status}`)}
    </span>
  );
}
