import { Link2 } from "lucide-react";
import { OBSTACLE_COLORS, ObstacleTypeIcon } from "@/components/map/obstacleIcons";
import { NEUTRAL, SURFACE_COLORS, ZONE_COLORS, ZONE_FALLBACK_COLOR } from "@/constants/palette";
import type {
  ObstacleResponse,
  SafetyZoneResponse,
  SurfaceResponse,
} from "@/types/airport";
import type { DrawingTool, MapFeature } from "@/types/map";
import InfrastructureListPanel from "@/components/coordinator/InfrastructureListPanel";
import CoordinatorAGLPanel from "@/components/coordinator/CoordinatorAGLPanel";
import { buildSurfaceDeleteWarnings } from "@/components/coordinator/surfaceDeleteWarnings";

interface AirportInfraPanelsProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  surfaces: SurfaceResponse[];
  orderedSurfaces: SurfaceResponse[];
  surfacePairPosition: Map<string, "first" | "second">;
  obstacles: ObstacleResponse[];
  boundaryZone: SafetyZoneResponse | undefined;
  regularSafetyZones: SafetyZoneResponse[];
  onFeatureClick: (feature: MapFeature) => void;
  onFeatureLocate: (feature: MapFeature) => void;
  onDeleteSurface: (id: string) => Promise<void>;
  onDeleteObstacle: (id: string) => Promise<void>;
  onDeleteSafetyZone: (id: string) => Promise<void>;
  onDeleteAgl: (id: string) => Promise<void>;
  onDeleteLha: (id: string) => Promise<void>;
  onSetActiveTool: (tool: DrawingTool) => void;
  onAddBoundary: () => void;
}

/** the five infrastructure list panels plus the agl panel for the airport editor. */
export default function AirportInfraPanels({
  t,
  surfaces,
  orderedSurfaces,
  surfacePairPosition,
  obstacles,
  boundaryZone,
  regularSafetyZones,
  onFeatureClick,
  onFeatureLocate,
  onDeleteSurface,
  onDeleteObstacle,
  onDeleteSafetyZone,
  onDeleteAgl,
  onDeleteLha,
  onSetActiveTool,
  onAddBoundary,
}: AirportInfraPanelsProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* infrastructure crud panels */}
      <InfrastructureListPanel
        title={t("airport.groundSurfaces")}
        items={orderedSurfaces}
        getId={(s) => s.id}
        getName={(s) => s.identifier}
        onEdit={(s) => onFeatureClick({ type: "surface", data: s })}
        onLocate={(s) => onFeatureLocate({ type: "surface", data: s })}
        onDelete={onDeleteSurface}
        addLabel={t("coordinator.detail.addSurface")}
        onAdd={() => onSetActiveTool("drawPolygon")}
        getDeleteWarnings={(s) => buildSurfaceDeleteWarnings(s, surfaces, t)}
        renderItem={(s) => {
          const partner = s.paired_surface_id
            ? surfaces.find((p) => p.id === s.paired_surface_id)
            : null;
          const pairPos = surfacePairPosition.get(s.id);
          return (
            <div className="relative flex items-center gap-2">
              <svg className="h-3.5 w-3.5 flex-shrink-0 text-tv-text-muted" viewBox="0 0 10 10">
                {s.surface_type === "RUNWAY" ? (
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
                    {s.surface_type === "RUNWAY" ? "RWY" : "TWY"} {s.identifier}
                  </span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                    style={{
                      borderColor: s.surface_type === "RUNWAY" ? "var(--tv-text-muted)" : "var(--tv-accent)",
                      color: s.surface_type === "RUNWAY" ? "var(--tv-text-muted)" : "var(--tv-accent)",
                    }}
                  >
                    {s.surface_type === "RUNWAY" ? t("airport.runway") : t("airport.taxiway")}
                  </span>
                </div>
                {s.length != null && s.width != null && (
                  <p className="text-[10px] text-tv-text-secondary mt-0.5">
                    {s.length.toFixed(2)}m × {s.width.toFixed(2)}m
                  </p>
                )}
              </div>
              {pairPos === "first" && partner && (
                <span
                  className="pointer-events-auto absolute right-0 -bottom-3 z-10 flex h-5 w-5 items-center justify-center rotate-90 text-tv-accent"
                  title={t("coordinator.detail.surfacePair.pairedBadge", {
                    identifier: partner.identifier,
                  })}
                  aria-label={t("coordinator.detail.surfacePair.pairedBadge", {
                    identifier: partner.identifier,
                  })}
                  data-testid={`surface-pair-chain-${s.id}`}
                >
                  <Link2 className="h-4 w-4" strokeWidth={2.5} />
                </span>
              )}
            </div>
          );
        }}
      />

      <InfrastructureListPanel
        title={t("airport.obstacles")}
        items={obstacles}
        getId={(o) => o.id}
        getName={(o) => o.name}
        onEdit={(o) => onFeatureClick({ type: "obstacle", data: o })}
        onLocate={(o) => onFeatureLocate({ type: "obstacle", data: o })}
        onDelete={onDeleteObstacle}
        addLabel={t("coordinator.detail.addObstacle")}
        onAdd={() => onSetActiveTool("drawCircle")}
        renderItem={(o) => {
          const color = OBSTACLE_COLORS[o.type] ?? NEUTRAL.MUTED;
          return (
            <div className="flex items-center gap-2">
              <ObstacleTypeIcon type={o.type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-tv-text-primary truncate">{o.name}</span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                    style={{ borderColor: color, color }}
                  >
                    {o.type}
                  </span>
                </div>
                <p className="text-[10px] text-tv-text-secondary mt-0.5">
                  {t("dashboard.poiHeight")}: {o.height.toFixed(2)}m
                </p>
              </div>
            </div>
          );
        }}
      />

      <InfrastructureListPanel
        title={t("boundary.airportBoundary")}
        items={boundaryZone ? [boundaryZone] : []}
        getId={(z) => z.id}
        getName={(z) => z.name}
        onEdit={(z) => onFeatureClick({ type: "safety_zone", data: z })}
        onLocate={(z) => onFeatureLocate({ type: "safety_zone", data: z })}
        onDelete={onDeleteSafetyZone}
        addLabel={t("boundary.addBoundary")}
        onAdd={boundaryZone ? undefined : onAddBoundary}
        renderItem={(z) => (
          <div className="flex items-center gap-2">
            <svg className="h-2.5 w-2.5 flex-shrink-0" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1"
                fill="none" stroke={NEUTRAL.WHITE} strokeWidth="1.2" strokeDasharray="2.5 1.5" />
            </svg>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-tv-text-primary truncate">{z.name}</span>
            </div>
          </div>
        )}
      />

      <InfrastructureListPanel
        title={t("airport.safetyZones")}
        items={regularSafetyZones}
        getId={(z) => z.id}
        getName={(z) => z.name}
        onEdit={(z) => onFeatureClick({ type: "safety_zone", data: z })}
        onLocate={(z) => onFeatureLocate({ type: "safety_zone", data: z })}
        onDelete={onDeleteSafetyZone}
        addLabel={t("coordinator.detail.addSafetyZone")}
        onAdd={() => onSetActiveTool("drawPolygon")}
        renderItem={(z) => {
          const color = ZONE_COLORS[z.type] ?? ZONE_FALLBACK_COLOR;
          return (
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-tv-text-primary truncate">{z.name}</span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium border"
                    style={{ borderColor: color, color }}
                  >
                    {t(`airport.zoneType.${z.type}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {z.altitude_floor != null && z.altitude_ceiling != null && (
                    <span className="text-[10px] text-tv-text-secondary">
                      {z.altitude_floor.toFixed(2)}m - {z.altitude_ceiling.toFixed(2)}m
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px]">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: z.is_active ? "var(--tv-success)" : NEUTRAL.MUTED }}
                    />
                    <span className="text-tv-text-muted">
                      {z.is_active ? t("airport.active") : t("airport.inactive")}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          );
        }}
      />

      <CoordinatorAGLPanel
        surfaces={surfaces}
        onSelect={onFeatureClick}
        onLocate={onFeatureLocate}
        onDeleteAgl={onDeleteAgl}
        onDeleteLha={onDeleteLha}
        onAdd={() => onSetActiveTool("placePoint")}
      />
    </div>
  );
}
