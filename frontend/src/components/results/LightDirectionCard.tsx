import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import InfoHint from "@/components/common/InfoHint";
import { lightColor } from "./chartColors";

// horizontal angle at the brightest frame - the direction the unit is aimed
function aimDirection(light: LightSeries): number | null {
  let best: { intensity: number; horizontal: number | null } | null = null;
  for (const p of light.points) {
    if (p.intensity === null) continue;
    if (best === null || p.intensity > best.intensity) {
      best = { intensity: p.intensity, horizontal: p.horizontal_angle };
    }
  }
  return best?.horizontal ?? null;
}

/** per-light summary of the horizontal angle of maximum luminosity. */
export default function LightDirectionCard({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="light-direction-card"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="text-sm font-medium text-tv-text-primary">
          {t("results.direction.title")}
        </h3>
        <InfoHint text={t("results.charts.explain.lightDirection")} />
      </div>
      {lights.length === 0 ? (
        <p className="text-sm text-tv-text-muted py-6 text-center">
          {t("results.noData")}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-tv-text-secondary border-b border-tv-border">
              <th className="py-2 pr-3 font-medium">
                {t("results.direction.column")}
              </th>
              <th className="py-2 font-medium">{t("results.direction.angle")}</th>
            </tr>
          </thead>
          <tbody>
            {lights.map((light) => {
              const direction = aimDirection(light);
              return (
                <tr
                  key={light.light_name}
                  className="border-b border-tv-border last:border-0"
                >
                  <td className="py-2 pr-3 text-tv-text-primary font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: lightColor(light.light_name) }}
                        aria-hidden="true"
                      />
                      {light.light_name}
                    </span>
                  </td>
                  <td className="py-2 text-tv-text-primary">
                    {direction === null ? "—" : `${direction.toFixed(1)}°`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
