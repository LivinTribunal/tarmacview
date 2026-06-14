import { useTranslation } from "react-i18next";
import { MapPin, AlertTriangle } from "lucide-react";
import Input from "@/components/common/Input";
import { LAT_BOUNDS, LON_BOUNDS } from "@/constants/geo";
import type { PointZ } from "@/types/common";

// flag a threshold/end position when it sits this far (meters) off the runway
// centerline - likely a misplaced pick rather than a real displaced threshold
const CENTERLINE_WARNING_DISTANCE_M = 50;

export default function PositionBlock({
  id,
  label,
  position,
  picking,
  onPickToggle,
  onChange,
  centerlineWarningDist,
  nested = false,
}: {
  id: string;
  label: string;
  position: PointZ | null;
  picking?: boolean;
  onPickToggle?: () => void;
  onChange: (pos: PointZ) => void;
  centerlineWarningDist: number | null;
  // when true, strip the outer card chrome so the block can sit inside a
  // parent container (e.g. the consolidated threshold/endpoint section)
  nested?: boolean;
}) {
  /** coordinate editor for a single threshold or end position. */
  const { t } = useTranslation();
  const coords = position?.coordinates;
  const lon = coords?.[0] ?? "";
  const lat = coords?.[1] ?? "";
  const alt = coords?.[2] ?? "";

  function commit(field: "lat" | "lon" | "alt", value: string) {
    /** parse and push coordinate update. */
    if (value === "") return;
    const v = parseFloat(value);
    if (isNaN(v)) return;
    if (field === "lat" && (v < LAT_BOUNDS.min || v > LAT_BOUNDS.max)) return;
    if (field === "lon" && (v < LON_BOUNDS.min || v > LON_BOUNDS.max)) return;
    const curLon = coords?.[0] ?? 0;
    const curLat = coords?.[1] ?? 0;
    const curAlt = coords?.[2] ?? 0;
    const newCoords: [number, number, number] = [
      field === "lon" ? v : curLon,
      field === "lat" ? v : curLat,
      field === "alt" ? v : curAlt,
    ];
    onChange({ type: "Point", coordinates: newCoords });
  }

  return (
    <div
      className={
        nested
          ? "space-y-1.5"
          : "mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
      }
      data-testid={`surface-${id}-section`}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={
            nested
              ? "text-[10px] font-semibold text-tv-text-secondary"
              : "text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide"
          }
        >
          {label}
        </p>
        {onPickToggle && (
          <button
            type="button"
            onClick={onPickToggle}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
              picking
                ? "border-tv-accent bg-tv-accent text-tv-accent-text"
                : "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
            }`}
            data-testid={`surface-${id}-pick-map`}
          >
            <MapPin className="h-3 w-3" />
            {t("mission.config.pickOnMap")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id={`feat-${id}-lat`}
          label={t("map.coordinates.lat")}
          hint={t("map.coordinates.latHelp")}
          type="number"
          step="0.000001"
          value={String(lat)}
          onChange={(e) => commit("lat", e.target.value)}
        />
        <Input
          id={`feat-${id}-lon`}
          label={t("map.coordinates.lon")}
          hint={t("map.coordinates.lonHelp")}
          type="number"
          step="0.000001"
          value={String(lon)}
          onChange={(e) => commit("lon", e.target.value)}
        />
      </div>
      <Input
        id={`feat-${id}-alt`}
        label={t("map.coordinates.alt")}
        hint={t("map.coordinates.altHelp")}
        type="number"
        step="0.01"
        value={String(alt)}
        onChange={(e) => commit("alt", e.target.value)}
      />
      {centerlineWarningDist != null && centerlineWarningDist > CENTERLINE_WARNING_DISTANCE_M && (
        <div className="flex items-center gap-1 text-[10px] text-tv-warning">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span>{t("coordinator.detail.centerlineWarning", { distance: Math.round(centerlineWarningDist) })}</span>
        </div>
      )}
    </div>
  );
}
