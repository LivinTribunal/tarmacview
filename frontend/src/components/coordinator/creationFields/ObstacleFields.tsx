import { useTranslation } from "react-i18next";
import Input from "@/components/common/Input";

interface ObstacleFieldsProps {
  obstacleHeight: string;
  setObstacleHeight: (value: string) => void;
  bufferDistance: string;
  setBufferDistance: (value: string) => void;
  circleCenter?: [number, number];
  pointPosition?: [number, number];
  obstacleHasSinglePoint: boolean;
  altLoading: boolean;
  manualAlt: string;
  handleAltChange: (value: string) => void;
  altFallback: boolean;
  prefilledArea?: number;
}

/** obstacle creation fields: height, buffer distance, optional point altitude. */
export default function ObstacleFields({
  obstacleHeight,
  setObstacleHeight,
  bufferDistance,
  setBufferDistance,
  circleCenter,
  pointPosition,
  obstacleHasSinglePoint,
  altLoading,
  manualAlt,
  handleAltChange,
  altFallback,
  prefilledArea,
}: ObstacleFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="create-height"
          label={t("coordinator.creation.obstacleHeight")}
          hint={t("coordinator.creation.obstacleHeightHelp")}
          type="number"
          value={obstacleHeight}
          onChange={(e) => setObstacleHeight(e.target.value)}
        />
        <Input
          id="create-buffer-distance"
          label={t("coordinator.creation.bufferDistance")}
          hint={t("coordinator.creation.bufferDistanceHelp")}
          type="number"
          value={bufferDistance}
          onChange={(e) => setBufferDistance(e.target.value)}
        />
      </div>
      {(circleCenter || pointPosition) && (
        <p className="text-[10px] text-tv-text-muted">
          {t("coordinator.creation.position")}:{" "}
          {(circleCenter ?? pointPosition)![1].toFixed(6)},{" "}
          {(circleCenter ?? pointPosition)![0].toFixed(6)}
        </p>
      )}
      {obstacleHasSinglePoint && (
        <div className="flex flex-col gap-0.5">
          <Input
            id="create-obstacle-alt"
            label={t("coordinator.creation.altitude")}
            hint={t("coordinator.creation.altitudeHelp")}
            type="number"
            step="0.01"
            value={altLoading ? "" : manualAlt}
            onChange={(e) => handleAltChange(e.target.value)}
            placeholder={altLoading ? t("coordinator.creation.altitudeLoading") : undefined}
            disabled={altLoading}
            data-testid="creation-obstacle-alt"
          />
          {altFallback && !altLoading && (
            <p
              className="text-[10px] text-tv-text-muted"
              data-testid="creation-obstacle-alt-fallback"
            >
              ({t("coordinator.creation.altitudeFallback")})
            </p>
          )}
        </div>
      )}
      {prefilledArea != null && (
        <p className="text-[10px] text-tv-text-muted">
          {t("coordinator.creation.area")}: {Math.round(prefilledArea)} m²
        </p>
      )}
    </>
  );
}
