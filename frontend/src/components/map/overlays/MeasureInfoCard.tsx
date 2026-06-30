import { useTranslation } from "react-i18next";
import { formatDistance } from "@/utils/geo";
import MapInfoCard from "@/components/common/MapInfoCard";

interface MeasureInfoCardProps {
  totalDistance: number;
  segmentCount: number;
  onClose: () => void;
}

export default function MeasureInfoCard({
  totalDistance,
  segmentCount,
  onClose,
}: MeasureInfoCardProps) {
  /** persistent info card showing completed measurement results. */
  const { t } = useTranslation();

  return (
    <MapInfoCard
      title={t("map.measureResult")}
      onClose={onClose}
      testId="measure-info-card"
    >
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-tv-text-muted">{t("map.totalDistance")}</span>
        <span className="text-tv-text-primary font-medium">
          {formatDistance(totalDistance)}
        </span>
      </div>
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-tv-text-muted">{t("map.segments")}</span>
        <span className="text-tv-text-primary font-medium">
          {segmentCount}
        </span>
      </div>
    </MapInfoCard>
  );
}
