import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import Input from "@/components/common/Input";

export default function SurfaceTouchpointSection({
  val,
  handleChange,
  pickingTouchpoint,
  onPickTouchpointToggle,
}: {
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
  pickingTouchpoint?: boolean;
  onPickTouchpointToggle?: () => void;
}) {
  /** touchpoint coordinate editor for a runway surface. */
  const { t } = useTranslation();

  return (
    <div
      className="mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
      data-testid="surface-touchpoint-section"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide">
          {t("coordinator.detail.touchpoint")}
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
            data-testid="surface-touchpoint-pick-map"
          >
            <MapPin className="h-3 w-3" />
            {t("mission.config.pickOnMap")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="feat-tp-lat"
          label={t("map.coordinates.lat")}
          hint={t("map.coordinates.latHelp")}
          type="number"
          step="0.000001"
          value={val("touchpoint_latitude")}
          onChange={(e) => handleChange(
            "touchpoint_latitude",
            e.target.value === "" ? null : parseFloat(e.target.value),
          )}
        />
        <Input
          id="feat-tp-lon"
          label={t("map.coordinates.lon")}
          hint={t("map.coordinates.lonHelp")}
          type="number"
          step="0.000001"
          value={val("touchpoint_longitude")}
          onChange={(e) => handleChange(
            "touchpoint_longitude",
            e.target.value === "" ? null : parseFloat(e.target.value),
          )}
        />
      </div>
      <Input
        id="feat-tp-alt"
        label={t("map.coordinates.alt")}
        hint={t("map.coordinates.altHelp")}
        type="number"
        step="0.01"
        value={val("touchpoint_altitude")}
        onChange={(e) => handleChange(
          "touchpoint_altitude",
          e.target.value === "" ? null : parseFloat(e.target.value),
        )}
      />
    </div>
  );
}
