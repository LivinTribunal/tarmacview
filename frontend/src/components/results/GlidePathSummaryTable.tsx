import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import {
  transitionVerdict,
  type TransitionVerdict,
} from "./TransitionAngleTable";
import VerdictBadge from "./VerdictBadge";

function fmtDeg(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}°`;
}

function mid(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : (a + b) / 2;
}

interface MetricRow {
  label: string;
  value: number | null;
  nominal: number | null;
  tolerance: number | null;
  verdict: TransitionVerdict;
}

/** glide-path angle summary - to-PAPI derived from PAPI_B/PAPI_C, to-touch-point gated. */
export default function GlidePathSummaryTable({
  lights,
  nominalGlideSlope = null,
  harmonizationTolerance = null,
}: {
  lights: LightSeries[];
  nominalGlideSlope?: number | null;
  harmonizationTolerance?: number | null;
}) {
  const { t } = useTranslation();
  const papiB = lights.find((l) => l.light_name === "PAPI_B");
  const papiC = lights.find((l) => l.light_name === "PAPI_C");

  // glide-path angle sits between PAPI_B's white edge and PAPI_C's red edge
  const gp = mid(
    papiB?.transition_angle_max ?? null,
    papiC?.transition_angle_min ?? null,
  );

  // touch-point glidepath from the touchpoint-referenced transition angles
  const gpTp = mid(
    papiB?.transition_angle_max_touchpoint ?? null,
    papiC?.transition_angle_min_touchpoint ?? null,
  );

  if (gp === null) {
    return (
      <>
        <h3 className="text-sm font-medium text-tv-text-primary mb-3">
          {t("results.glidePath.title")}
        </h3>
        <p className="text-sm text-tv-text-muted py-6 text-center">
          {t("results.glidePath.empty")}
        </p>
      </>
    );
  }

  const nominal = mid(
    papiB?.setting_angle ?? null,
    papiC?.setting_angle ?? null,
  );
  const tolerance = papiB?.tolerance ?? papiC?.tolerance ?? null;

  const rows: MetricRow[] = [
    {
      label: t("results.glidePath.toPapi"),
      value: gp,
      nominal,
      tolerance,
      verdict: transitionVerdict(gp, nominal, tolerance),
    },
    {
      label: t("results.glidePath.toTouchPoint"),
      value: gpTp,
      nominal: nominalGlideSlope,
      tolerance: harmonizationTolerance,
      verdict: transitionVerdict(gpTp, nominalGlideSlope, harmonizationTolerance),
    },
  ];

  return (
    <>
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">
        {t("results.glidePath.title")}
      </h3>
      <table className="w-full text-sm" data-testid="glide-path-summary-table">
        <thead>
          <tr className="text-left text-tv-text-secondary border-b border-tv-border">
            <th className="py-2 pr-3 font-medium">
              {t("results.glidePath.metric")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.glidePath.value")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.glidePath.nominal")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.glidePath.tolerance")}
            </th>
            <th className="py-2 font-medium">{t("results.glidePath.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.label}
              className="border-b border-tv-border last:border-0"
            >
              <td className="py-2 pr-3 text-tv-text-primary font-medium">
                {r.label}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmtDeg(r.value)}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmtDeg(r.nominal)}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmtDeg(r.tolerance)}
              </td>
              <td className="py-2">
                <VerdictBadge verdict={r.verdict} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
