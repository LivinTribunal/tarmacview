import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { DeviceResults, MissionLightResult } from "@/types/measurement";
import Card from "@/components/common/Card";
import EvaluationPill from "./EvaluationPill";

function fmt(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}°`;
}

function nominal(setting: number | null, tolerance: number | null): string {
  if (setting === null) return "—";
  const base = `${setting.toFixed(2)}°`;
  return tolerance === null ? base : `${base} ± ${tolerance.toFixed(2)}°`;
}

/** greyed N/A tag - visually distinct from a FAIL so a placeholder never reads as one. */
function NotMeasuredTag() {
  const { t } = useTranslation();
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-xs bg-tv-surface-hover text-tv-text-muted"
      data-testid="not-measured-tag"
    >
      {t("results.overview.notMeasured")}
    </span>
  );
}

function LightRow({ light }: { light: MissionLightResult }) {
  if (light.not_measured) {
    return (
      <tr
        className="border-b border-tv-border last:border-0 text-tv-text-muted"
        data-testid="light-row-not-measured"
      >
        <td className="py-2 pr-3 font-medium">
          {light.unit_designator ?? light.light_name}
        </td>
        <td className="py-2 pr-3">{nominal(light.setting_angle, light.tolerance)}</td>
        <td className="py-2 pr-3">—</td>
        <td className="py-2">
          <NotMeasuredTag />
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-tv-border last:border-0" data-testid="light-row-measured">
      <td className="py-2 pr-3 text-tv-text-primary font-medium">
        {light.unit_designator ?? light.light_name}
      </td>
      <td className="py-2 pr-3 text-tv-text-primary">
        {nominal(light.setting_angle, light.tolerance)}
      </td>
      <td className="py-2 pr-3 text-tv-text-primary">
        {fmt(light.measured_transition_angle)}
      </td>
      <td className="py-2">
        {light.passed === null ? (
          <span className="text-tv-text-muted">—</span>
        ) : light.passed ? (
          <Check
            className="h-4 w-4 text-[var(--tv-status-completed-text)]"
            data-testid="light-pass"
          />
        ) : (
          <X
            className="h-4 w-4 text-[var(--tv-status-cancelled-text)]"
            data-testid="light-fail"
          />
        )}
      </td>
    </tr>
  );
}

/** one device's protocol table - glide slope, per-light rows, greyed placeholder rows. */
export default function DeviceProtocolSection({
  device,
  onDrillDown,
}: {
  device: DeviceResults;
  onDrillDown: (inspectionId: string) => void;
}) {
  const { t } = useTranslation();
  const drillable = device.status === "DONE" && !!device.inspection_id;

  const headerContent = (
    <>
      <span className="text-sm font-semibold text-tv-text-primary">
        {device.device_label}
      </span>
      <EvaluationPill result={device.evaluation} />
    </>
  );

  return (
    <div data-testid={`device-section-${device.device_label}`}>
      <Card>
        <div className="flex items-center justify-between mb-3">
        {drillable ? (
          <button
            type="button"
            className="flex items-center gap-2 hover:underline"
            onClick={() => onDrillDown(device.inspection_id as string)}
            data-testid="device-drill-down"
          >
            {headerContent}
          </button>
        ) : (
          <div className="flex items-center gap-2">{headerContent}</div>
        )}
      </div>

      {device.glide_slope && (
        <div
          className="flex items-center justify-between text-sm mb-3 pb-3 border-b border-tv-border"
          data-testid="glide-slope-row"
        >
          <span className="text-tv-text-secondary">
            {t("results.overview.device.glideSlope")}
          </span>
          <span className="text-tv-text-primary">
            {fmt(device.glide_slope.measured_glide_slope_angle)}
            {" / "}
            {nominal(
              device.glide_slope.configured_glide_slope_angle,
              device.glide_slope.glide_slope_angle_tolerance,
            )}
          </span>
        </div>
      )}

      {device.lights.length > 0 && (
        <table className="w-full text-sm mb-3">
          <thead>
            <tr className="text-left text-tv-text-secondary border-b border-tv-border">
              <th className="py-2 pr-3 font-medium">
                {t("results.overview.device.light")}
              </th>
              <th className="py-2 pr-3 font-medium">
                {t("results.overview.device.configured")}
              </th>
              <th className="py-2 pr-3 font-medium">
                {t("results.overview.device.measured")}
              </th>
              <th className="py-2 font-medium">
                {t("results.overview.device.result")}
              </th>
            </tr>
          </thead>
          <tbody>
            {device.lights.map((light) => (
              <LightRow key={light.light_name} light={light} />
            ))}
          </tbody>
        </table>
      )}

      {device.placeholder_rows.length > 0 && (
        <ul className="space-y-1" data-testid="placeholder-rows">
          {device.placeholder_rows.map((key) => (
            <li
              key={key}
              className="flex items-center justify-between text-sm text-tv-text-muted"
            >
              <span>{t(`results.overview.rows.${key}`)}</span>
              <NotMeasuredTag />
            </li>
          ))}
        </ul>
      )}
      </Card>
    </div>
  );
}
