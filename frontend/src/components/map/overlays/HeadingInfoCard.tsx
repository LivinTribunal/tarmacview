import { useTranslation } from "react-i18next";
import MapInfoCard from "@/components/common/MapInfoCard";

interface HeadingInfoCardProps {
  bearing: number;
  onClose: () => void;
}

export default function HeadingInfoCard({
  bearing,
  onClose,
}: HeadingInfoCardProps) {
  /** persistent info card showing completed heading measurement. */
  const { t } = useTranslation();

  return (
    <MapInfoCard
      title={t("map.headingResult")}
      onClose={onClose}
      testId="heading-info-card"
    >
      <div className="flex justify-between gap-3 text-xs">
        <span className="text-tv-text-muted">{t("map.bearing")}</span>
        <span className="text-tv-text-primary font-medium">
          {bearing.toFixed(2)}&deg;
        </span>
      </div>
    </MapInfoCard>
  );
}
