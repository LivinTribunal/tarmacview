import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapLayerConfig, MapFeature } from "@/types/map";
import type { WaypointResponse, ValidationViolation } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import LayerPanel from "./LayerPanel";
import PoiInfoPanel from "./PoiInfoPanel";
import WarningInfoPanel from "./WarningInfoPanel";
import WaypointListPanel from "./WaypointListPanel";

export interface MapLeftPanelClusterProps {
  airport: AirportDetailResponse;
  layerConfig: MapLayerConfig;
  onLayerToggle: (key: string) => void;
  waypoints?: WaypointResponse[];
  selectedWaypointId?: string | null;
  onWaypointSelect: (wpId: string | null) => void;
  onWaypointLocate: (wpId: string) => void;
  visibleInspectionIds?: Set<string>;
  inspectionIndexMap?: Record<string, number>;
  takeoffCoordinate?: PointZ | null;
  landingCoordinate?: PointZ | null;
  selectedFeature: MapFeature | null;
  onCloseSelectedFeature: () => void;
  selectedWarning?: ValidationViolation | null;
  onWarningClose?: () => void;
  showLayerPanel: boolean;
  showWaypointList: boolean;
  showPoiInfo: boolean;
  onPlaceTakeoff?: () => void;
  onPlaceLanding?: () => void;
  leftPanelChildren?: ReactNode;
}

/** top-left overlay column: layer panel, waypoint list, poi/warning info, takeoff/landing placement buttons. */
export default function MapLeftPanelCluster({
  airport,
  layerConfig,
  onLayerToggle,
  waypoints,
  selectedWaypointId,
  onWaypointSelect,
  onWaypointLocate,
  visibleInspectionIds,
  inspectionIndexMap,
  takeoffCoordinate,
  landingCoordinate,
  selectedFeature,
  onCloseSelectedFeature,
  selectedWarning,
  onWarningClose,
  showLayerPanel,
  showWaypointList,
  showPoiInfo,
  onPlaceTakeoff,
  onPlaceLanding,
  leftPanelChildren,
}: MapLeftPanelClusterProps) {
  const { t } = useTranslation();

  if (!showLayerPanel && !showWaypointList && !showPoiInfo && !leftPanelChildren) {
    return null;
  }

  const waypointListVisible =
    showWaypointList &&
    layerConfig.trajectory &&
    !layerConfig.simplifiedTrajectory &&
    (!!waypoints?.length || !!takeoffCoordinate || !!landingCoordinate);

  return (
    <div
      className="absolute top-3 left-3 z-10 flex flex-col gap-2 w-[280px] overflow-y-auto pr-1"
      style={{ maxHeight: "calc(100% - 68px)", scrollbarGutter: "stable" }}
    >
      {showLayerPanel && (
        <LayerPanel
          layers={layerConfig}
          onToggle={onLayerToggle}
          hasFlightPlan={!!(waypoints?.length)}
          hasTakeoffLanding={!!(takeoffCoordinate || landingCoordinate)}
        />
      )}
      {leftPanelChildren}
      {waypointListVisible && (
        <WaypointListPanel
          waypoints={waypoints ?? []}
          selectedId={selectedWaypointId ?? null}
          onSelect={onWaypointSelect}
          onLocate={onWaypointLocate}
          takeoffCoordinate={takeoffCoordinate}
          landingCoordinate={landingCoordinate}
          visibleInspectionIds={visibleInspectionIds}
          inspectionIndexMap={inspectionIndexMap}
        />
      )}
      {showPoiInfo && (
        <PoiInfoPanel
          feature={selectedFeature}
          onClose={onCloseSelectedFeature}
          surfaces={airport.surfaces}
        />
      )}
      {selectedWarning && onWarningClose && (
        <WarningInfoPanel
          violation={selectedWarning}
          onClose={onWarningClose}
        />
      )}

      {/* placement buttons - full width, after waypoint list */}
      {!takeoffCoordinate && onPlaceTakeoff && (
        <button
          type="button"
          onClick={onPlaceTakeoff}
          className="flex items-center justify-center gap-2 w-full rounded-2xl px-3 py-2 text-xs font-semibold border border-tv-success text-white transition-colors"
          style={{ backgroundColor: "var(--tv-success)" }}
          data-testid="place-takeoff-btn"
        >
          <Flag className="h-3.5 w-3.5" />
          {t("map.placeTakeoff")}
        </button>
      )}
      {!landingCoordinate && onPlaceLanding && (
        <button
          type="button"
          onClick={onPlaceLanding}
          className="flex items-center justify-center gap-2 w-full rounded-2xl px-3 py-2 text-xs font-semibold border border-tv-error text-white transition-colors"
          style={{ backgroundColor: "var(--tv-error)" }}
          data-testid="place-landing-btn"
        >
          <Flag className="h-3.5 w-3.5" />
          {t("map.placeLanding")}
        </button>
      )}
    </div>
  );
}
