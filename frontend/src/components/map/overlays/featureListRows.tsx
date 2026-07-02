import { Link2 } from "lucide-react";
import { OBSTACLE_COLORS, ObstacleTypeIcon } from "@/components/map/obstacleIcons";
import { NEUTRAL, SURFACE_COLORS, ZONE_COLORS, ZONE_FALLBACK_COLOR } from "@/constants/palette";
import { formatNumber } from "@/utils/format";
import { datumHeightLabel, mslAglRangeLabel } from "@/utils/altitudeLabel";
import type { TFn } from "@/config/featureFields";
import type {
  ObstacleResponse,
  SafetyZoneResponse,
  SurfaceResponse,
} from "@/types/airport";

/** shared inner content for a surface list row (icon + name + type badge +
 * dimensions), plus the paired-runway chain badge. callers own the outer
 * button / click handlers; the wrapper must be `relative` for the badge. */
export function SurfaceListRow({
  surface,
  t,
  partner,
  pairPosition,
}: {
  surface: SurfaceResponse;
  t: TFn;
  partner?: SurfaceResponse | null;
  pairPosition?: "first" | "second";
}) {
  const isRunway = surface.surface_type === "RUNWAY";
  const accent = isRunway ? "var(--tv-text-muted)" : "var(--tv-accent)";
  return (
    <>
      <svg className="h-3.5 w-3.5 flex-shrink-0 text-tv-text-muted" viewBox="0 0 10 10">
        {isRunway ? (
          <>
            <rect x="1" y="0" width="8" height="10" rx="1" fill="currentColor" />
            <line x1="5" y1="1" x2="5" y2="9" stroke="white" strokeWidth="0.8" strokeDasharray="1.5 1" />
          </>
        ) : (
          <>
            <rect x="1" y="0" width="8" height="10" rx="1" fill={SURFACE_COLORS.TAXIWAY_FILL} />
            <line x1="5" y1="1" x2="5" y2="9" stroke={SURFACE_COLORS.TAXIWAY_CENTERLINE} strokeWidth="0.7" strokeDasharray="1.5 1" />
          </>
        )}
      </svg>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-tv-text-primary truncate">
            {isRunway ? "RWY" : "TWY"} {surface.identifier}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
            style={{ borderColor: accent, color: accent }}
          >
            {isRunway ? t("airport.runway") : t("airport.taxiway")}
          </span>
        </div>
        {surface.length != null && surface.width != null && (
          <p className="text-[10px] text-tv-text-secondary mt-0.5">
            {formatNumber(surface.length, 2)}{t("common.units.m")} × {formatNumber(surface.width, 2)}{t("common.units.m")}
          </p>
        )}
      </div>
      {pairPosition === "first" && partner && (
        <span
          className="pointer-events-none absolute right-0 -bottom-3 z-10 flex h-5 w-5 items-center justify-center rotate-90 text-tv-accent"
          title={t("coordinator.detail.surfacePair.pairedBadge", { identifier: partner.identifier })}
          aria-label={t("coordinator.detail.surfacePair.pairedBadge", { identifier: partner.identifier })}
          data-testid={`surface-pair-chain-${surface.id}`}
        >
          <Link2 className="h-4 w-4" strokeWidth={2.5} />
        </span>
      )}
    </>
  );
}

/** shared inner content for an obstacle list row; height is datum-labeled AGL. */
export function ObstacleListRow({ obstacle, t }: { obstacle: ObstacleResponse; t: TFn }) {
  const color = OBSTACLE_COLORS[obstacle.type] ?? NEUTRAL.MUTED;
  return (
    <>
      <ObstacleTypeIcon type={obstacle.type} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-tv-text-primary truncate">{obstacle.name}</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
            style={{ borderColor: color, color }}
          >
            {obstacle.type}
          </span>
        </div>
        <p className="text-[10px] text-tv-text-secondary mt-0.5">
          {t("featureFields.height")}: {datumHeightLabel(obstacle.height, t, "AGL")}
        </p>
      </div>
    </>
  );
}

/** shared inner content for a safety-zone list row; floor/ceiling range is
 * datum-labeled MSL, with the AGL range appended when derived. */
export function SafetyZoneListRow({ zone, t }: { zone: SafetyZoneResponse; t: TFn }) {
  const color = ZONE_COLORS[zone.type] ?? ZONE_FALLBACK_COLOR;
  const altRange = mslAglRangeLabel(
    zone.altitude_floor,
    zone.altitude_ceiling,
    zone.altitude_floor_agl,
    zone.altitude_ceiling_agl,
    t,
    2,
  );
  return (
    <>
      <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-tv-text-primary truncate">{zone.name}</span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
            style={{ borderColor: color, color }}
          >
            {t(`airport.zoneType.${zone.type}`)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {altRange && <span className="text-[10px] text-tv-text-secondary">{altRange}</span>}
          <span className="flex items-center gap-1 text-[10px]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: zone.is_active ? "var(--tv-success)" : ZONE_FALLBACK_COLOR }}
            />
            <span className="text-tv-text-muted">
              {zone.is_active ? t("airport.active") : t("airport.inactive")}
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
