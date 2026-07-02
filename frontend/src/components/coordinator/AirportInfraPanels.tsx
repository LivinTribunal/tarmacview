import { NEUTRAL } from "@/constants/palette";
import type {
  ObstacleResponse,
  SafetyZoneResponse,
  SurfaceResponse,
} from "@/types/airport";
import type { DrawingTool, MapFeature } from "@/types/map";
import InfrastructureListPanel from "@/components/coordinator/InfrastructureListPanel";
import AGLPanel from "@/components/map/overlays/AGLPanel";
import {
  ObstacleListRow,
  SafetyZoneListRow,
  SurfaceListRow,
} from "@/components/map/overlays/featureListRows";
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
        renderItem={(s) => (
          <div className="relative flex items-center gap-2">
            <SurfaceListRow
              surface={s}
              t={t}
              partner={
                s.paired_surface_id ? surfaces.find((p) => p.id === s.paired_surface_id) : null
              }
              pairPosition={surfacePairPosition.get(s.id)}
            />
          </div>
        )}
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
        renderItem={(o) => (
          <div className="flex items-center gap-2">
            <ObstacleListRow obstacle={o} t={t} />
          </div>
        )}
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
        renderItem={(z) => (
          <div className="flex items-center gap-2">
            <SafetyZoneListRow zone={z} t={t} />
          </div>
        )}
      />

      <AGLPanel
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
