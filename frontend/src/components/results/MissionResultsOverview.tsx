import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { MissionResults } from "@/types/measurement";
import Card from "@/components/common/Card";
import DeviceProtocolSection from "./DeviceProtocolSection";
import MissionEvaluationTable from "./MissionEvaluationTable";

interface MissionResultsOverviewProps {
  overview: MissionResults | null;
  loading: boolean;
  error: boolean;
  onDrillDown: (inspectionId: string) => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-tv-text-secondary">{label}</dt>
      <dd className="text-sm text-tv-text-primary">{value}</dd>
    </div>
  );
}

/** protocol-style mission overview - header, weather, per-device sections, evaluation. */
export default function MissionResultsOverview({
  overview,
  loading,
  error,
  onDrillDown,
}: MissionResultsOverviewProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-64 text-tv-text-muted"
        data-testid="overview-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !overview) {
    return (
      <div className="p-6 text-sm text-tv-error" data-testid="overview-error">
        {t("results.loadError")}
      </div>
    );
  }

  const { header, weather } = overview;
  const dash = "—";
  const na = t("results.overview.notMeasured");

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="mission-results-overview">
      <Card>
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.overview.title")}
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field
            label={t("results.overview.header.airport")}
            value={`${header.airport_icao} ${header.airport_name}`.trim()}
          />
          <Field
            label={t("results.overview.header.mission")}
            value={header.mission_name}
          />
          <Field
            label={t("results.overview.header.date")}
            value={
              header.measurement_date
                ? new Date(header.measurement_date).toLocaleDateString()
                : dash
            }
          />
          <Field
            label={t("results.overview.header.drone")}
            value={header.drone_model ?? dash}
          />
          <Field
            label={t("results.overview.header.opticalSensor")}
            value={header.optical_sensor ?? dash}
          />
          <Field
            label={t("results.overview.header.referenceSystem")}
            value={header.reference_system ?? dash}
          />
          <Field
            label={t("results.overview.header.certificateNumber")}
            value={header.certificate_number ?? dash}
          />
        </dl>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.overview.weather.title")}
        </h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field
            label={t("results.overview.weather.temperature")}
            value={
              weather.temperature_c === null ? na : `${weather.temperature_c} °C`
            }
          />
          <Field
            label={t("results.overview.weather.wind")}
            value={weather.wind ?? na}
          />
          <Field
            label={t("results.overview.weather.visibility")}
            value={weather.visibility ?? na}
          />
          <Field
            label={t("results.overview.weather.conditions")}
            value={weather.conditions ?? na}
          />
        </dl>
      </Card>

      {overview.runways.map((runway) => (
        <section
          key={runway.surface_id ?? "unassigned"}
          className="space-y-3"
          data-testid="runway-block"
        >
          <h3 className="text-sm font-semibold text-tv-text-primary">
            {runway.runway_identifier
              ? t("results.overview.runway", { id: runway.runway_identifier })
              : t("results.overview.runwayUnassigned")}
          </h3>
          {runway.devices.map((device, idx) => (
            <DeviceProtocolSection
              key={device.inspection_id ?? `${device.device_label}-${idx}`}
              device={device}
              onDrillDown={onDrillDown}
            />
          ))}
        </section>
      ))}

      <Card>
        <h3 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.overview.evaluation.title")}
        </h3>
        <MissionEvaluationTable evaluation={overview.evaluation} />
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-tv-text-primary mb-2">
          {t("results.overview.recommendations.title")}
        </h3>
        <p className="text-sm text-tv-text-muted">
          {overview.recommendations ?? t("results.overview.noRecommendations")}
        </p>
      </Card>
    </div>
  );
}
