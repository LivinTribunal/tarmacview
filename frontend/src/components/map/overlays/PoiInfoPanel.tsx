import { useTranslation } from "react-i18next";
import FeatureInfoPanel from "@/components/common/FeatureInfoPanel";
import type { MapFeature } from "@/types/map";
import type { SurfaceResponse } from "@/types/airport";
import AglInfoPanel from "./poi/AglInfoPanel";
import LhaInfoPanel from "./poi/LhaInfoPanel";
import ObstacleInfoPanel from "./poi/ObstacleInfoPanel";
import SafetyZoneInfoPanel from "./poi/SafetyZoneInfoPanel";
import SurfaceInfoPanel from "./poi/SurfaceInfoPanel";
import WaypointInfoPanel from "./poi/WaypointInfoPanel";

interface PoiInfoPanelProps {
  feature: MapFeature | null;
  onClose: () => void;
  editable?: boolean;
  surfaces?: SurfaceResponse[];
  onCoordinateChange?: (waypointId: string, lat: number, lon: number, alt: number) => void;
  onDeleteTakeoffLanding?: (waypointType: string) => void;
}

export default function PoiInfoPanel({
  feature,
  onClose,
  editable = false,
  surfaces,
  onCoordinateChange,
  onDeleteTakeoffLanding,
}: PoiInfoPanelProps) {
  /** single feature-info panel for every clicked map feature, waypoints included. */
  const { t } = useTranslation();

  if (!feature) return null;

  function renderContent() {
    if (!feature) return null;
    switch (feature.type) {
      case "surface":
        return <SurfaceInfoPanel surface={feature.data} />;
      case "obstacle":
        return <ObstacleInfoPanel obstacle={feature.data} />;
      case "safety_zone":
        return <SafetyZoneInfoPanel zone={feature.data} />;
      case "agl":
        return <AglInfoPanel agl={feature.data} surfaces={surfaces} />;
      case "lha":
        return <LhaInfoPanel lha={feature.data} />;
      case "waypoint":
        return (
          <WaypointInfoPanel
            waypoint={feature.data}
            editable={editable}
            onCoordinateChange={onCoordinateChange}
            onDeleteTakeoffLanding={onDeleteTakeoffLanding}
          />
        );
    }
  }

  return (
    <div className="w-full flex-shrink-0" data-testid="poi-info-panel">
      <FeatureInfoPanel title={t("dashboard.poiInfo")} onClose={onClose}>
        <div className="space-y-1">{renderContent()}</div>
      </FeatureInfoPanel>
    </div>
  );
}
