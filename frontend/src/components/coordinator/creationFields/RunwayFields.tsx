import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, MapPin, Repeat } from "lucide-react";
import Input from "@/components/common/Input";
import InfoHint from "@/components/common/InfoHint";

interface RunwayFieldsProps {
  isRunway: boolean;
  heading: string;
  setHeading: Dispatch<SetStateAction<string>>;
  length: string;
  setLength: Dispatch<SetStateAction<string>>;
  width: string;
  setWidth: Dispatch<SetStateAction<string>>;
  touchpointLat: string;
  setTouchpointLat: Dispatch<SetStateAction<string>>;
  touchpointLon: string;
  setTouchpointLon: Dispatch<SetStateAction<string>>;
  touchpointAlt: string;
  setTouchpointAlt: Dispatch<SetStateAction<string>>;
  pickingTouchpoint: boolean;
  onPickTouchpointToggle?: () => void;
  // runway-only editable threshold/end pickers - seeded from the drawn centerline,
  // free-form editable thereafter. omit on non-drawn entries.
  thresholdLat?: string;
  setThresholdLat?: Dispatch<SetStateAction<string>>;
  thresholdLon?: string;
  setThresholdLon?: Dispatch<SetStateAction<string>>;
  thresholdAlt?: string;
  setThresholdAlt?: Dispatch<SetStateAction<string>>;
  endLat?: string;
  setEndLat?: Dispatch<SetStateAction<string>>;
  endLon?: string;
  setEndLon?: Dispatch<SetStateAction<string>>;
  endAlt?: string;
  setEndAlt?: Dispatch<SetStateAction<string>>;
  pickingThreshold?: boolean;
  onPickThresholdToggle?: () => void;
  pickingEnd?: boolean;
  onPickEndToggle?: () => void;
  onSwapThresholdEnd?: () => void;
}

/** runway / taxiway creation fields: heading, length, width, optional touchpoint. */
export default function RunwayFields({
  isRunway,
  heading,
  setHeading,
  length,
  setLength,
  width,
  setWidth,
  touchpointLat,
  setTouchpointLat,
  touchpointLon,
  setTouchpointLon,
  touchpointAlt,
  setTouchpointAlt,
  pickingTouchpoint,
  onPickTouchpointToggle,
  thresholdLat,
  setThresholdLat,
  thresholdLon,
  setThresholdLon,
  thresholdAlt,
  setThresholdAlt,
  endLat,
  setEndLat,
  endLon,
  setEndLon,
  endAlt,
  setEndAlt,
  pickingThreshold,
  onPickThresholdToggle,
  pickingEnd,
  onPickEndToggle,
  onSwapThresholdEnd,
}: RunwayFieldsProps) {
  const showThresholdEnd =
    isRunway
    && thresholdLat !== undefined
    && thresholdLon !== undefined
    && thresholdAlt !== undefined
    && endLat !== undefined
    && endLon !== undefined
    && endAlt !== undefined
    && setThresholdLat
    && setThresholdLon
    && setThresholdAlt
    && setEndLat
    && setEndLon
    && setEndAlt;
  const { t } = useTranslation();
  return (
    <>
      <Input
        id="create-heading"
        label={t("coordinator.creation.heading")}
        hint={t("coordinator.creation.headingHelp")}
        type="number"
        value={heading}
        onChange={(e) => setHeading(e.target.value)}
      />
      {heading && (
        <div className="flex items-center gap-2">
          <svg className="h-6 w-6 flex-shrink-0" viewBox="0 0 24 24">
            <line
              x1="12" y1="20" x2="12" y2="4"
              stroke="var(--tv-accent)" strokeWidth="2" strokeLinecap="round"
              transform={`rotate(${parseFloat(heading)}, 12, 12)`}
            />
            <polygon
              points="12,2 9,8 15,8"
              fill="var(--tv-accent)"
              transform={`rotate(${parseFloat(heading)}, 12, 12)`}
            />
          </svg>
          <button
            type="button"
            onClick={() => {
              const current = parseFloat(heading);
              if (!isNaN(current)) setHeading(String((current + 180) % 360));
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
            title={t("coordinator.detail.oppositeHeading")}
          >
            <RotateCcw className="h-3 w-3" />
            {t("coordinator.detail.opposite")}
          </button>
          <span className="text-[10px] text-tv-text-muted">
            {Math.round(((parseFloat(heading) + 180) % 360) * 10) / 10}°
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="create-length"
          label={t("coordinator.creation.length")}
          hint={t("coordinator.creation.lengthHelp")}
          type="number"
          value={length}
          onChange={(e) => setLength(e.target.value)}
        />
        <Input
          id="create-width"
          label={t("coordinator.creation.width")}
          hint={t("coordinator.creation.widthHelp")}
          type="number"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
        />
      </div>
      {showThresholdEnd && (
        <div
          className="mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
          data-testid="creation-threshold-end-section"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <p className="text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide">
                {t("coordinator.creation.thresholdEnd")}
              </p>
              <InfoHint
                text={t("coordinator.creation.thresholdEndHelp")}
                label={t("coordinator.creation.thresholdEnd")}
                testId="hint-creation-threshold-end"
              />
            </div>
            <button
              type="button"
              onClick={onSwapThresholdEnd}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text transition-colors"
              data-testid="creation-threshold-end-swap"
            >
              <Repeat className="h-3 w-3" />
              {t("coordinator.creation.swapThresholdEnd")}
            </button>
          </div>
          <div
            className="space-y-1.5"
            data-testid="creation-threshold-readout"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-tv-text-secondary">
                {t("coordinator.creation.thresholdLabel")}
              </p>
              {onPickThresholdToggle && (
                <button
                  type="button"
                  onClick={onPickThresholdToggle}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                    pickingThreshold
                      ? "border-tv-accent bg-tv-accent text-tv-accent-text"
                      : "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
                  }`}
                  data-testid="creation-threshold-pick-map"
                >
                  <MapPin className="h-3 w-3" />
                  {t("mission.config.pickOnMap")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                id="create-threshold-lat"
                label={t("map.coordinates.lat")}
                hint={t("map.coordinates.latHelp")}
                type="number"
                step="0.000001"
                value={thresholdLat}
                onChange={(e) => setThresholdLat(e.target.value)}
              />
              <Input
                id="create-threshold-lon"
                label={t("map.coordinates.lon")}
                hint={t("map.coordinates.lonHelp")}
                type="number"
                step="0.000001"
                value={thresholdLon}
                onChange={(e) => setThresholdLon(e.target.value)}
              />
            </div>
            <Input
              id="create-threshold-alt"
              label={t("map.coordinates.alt")}
              hint={t("map.coordinates.altHelp")}
              type="number"
              step="0.01"
              value={thresholdAlt}
              onChange={(e) => setThresholdAlt(e.target.value)}
            />
          </div>
          <div
            className="space-y-1.5"
            data-testid="creation-end-readout"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-tv-text-secondary">
                {t("coordinator.creation.endpointLabel")}
              </p>
              {onPickEndToggle && (
                <button
                  type="button"
                  onClick={onPickEndToggle}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                    pickingEnd
                      ? "border-tv-accent bg-tv-accent text-tv-accent-text"
                      : "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
                  }`}
                  data-testid="creation-end-pick-map"
                >
                  <MapPin className="h-3 w-3" />
                  {t("mission.config.pickOnMap")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                id="create-end-lat"
                label={t("map.coordinates.lat")}
                hint={t("map.coordinates.latHelp")}
                type="number"
                step="0.000001"
                value={endLat}
                onChange={(e) => setEndLat(e.target.value)}
              />
              <Input
                id="create-end-lon"
                label={t("map.coordinates.lon")}
                hint={t("map.coordinates.lonHelp")}
                type="number"
                step="0.000001"
                value={endLon}
                onChange={(e) => setEndLon(e.target.value)}
              />
            </div>
            <Input
              id="create-end-alt"
              label={t("map.coordinates.alt")}
              hint={t("map.coordinates.altHelp")}
              type="number"
              step="0.01"
              value={endAlt}
              onChange={(e) => setEndAlt(e.target.value)}
            />
          </div>
        </div>
      )}
      {isRunway && (
        <div
          className="mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
          data-testid="creation-touchpoint-section"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide">
              {t("coordinator.creation.touchpoint")}
            </p>
            {onPickTouchpointToggle && (
              <button
                type="button"
                onClick={onPickTouchpointToggle}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
                  pickingTouchpoint
                    ? "border-tv-accent bg-tv-accent text-tv-accent-text"
                    : "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
                }`}
                data-testid="creation-touchpoint-pick-map"
              >
                <MapPin className="h-3 w-3" />
                {t("mission.config.pickOnMap")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              id="create-tp-lat"
              label={t("map.coordinates.lat")}
              hint={t("map.coordinates.latHelp")}
              type="number"
              step="0.000001"
              value={touchpointLat}
              onChange={(e) => setTouchpointLat(e.target.value)}
            />
            <Input
              id="create-tp-lon"
              label={t("map.coordinates.lon")}
              hint={t("map.coordinates.lonHelp")}
              type="number"
              step="0.000001"
              value={touchpointLon}
              onChange={(e) => setTouchpointLon(e.target.value)}
            />
          </div>
          <Input
            id="create-tp-alt"
            label={t("map.coordinates.alt")}
            hint={t("map.coordinates.altHelp")}
            type="number"
            step="0.01"
            value={touchpointAlt}
            onChange={(e) => setTouchpointAlt(e.target.value)}
          />
        </div>
      )}
    </>
  );
}
