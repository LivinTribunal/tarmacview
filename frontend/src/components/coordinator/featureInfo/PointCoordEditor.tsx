import { useTranslation } from "react-i18next";
import Input from "@/components/common/Input";
import { LAT_BOUNDS, LON_BOUNDS } from "@/constants/geo";
import type { PointZ } from "@/types/common";

export default function PointCoordEditor({
  position,
  onChange,
}: {
  position: PointZ | null;
  onChange: (coords: [number, number, number]) => void;
}) {
  /** inline lat/lon/alt editor for a point geometry. */
  const { t } = useTranslation();
  if (!position || position.coordinates.length < 3) return null;
  const [lon, lat, alt] = position.coordinates;

  function commit(field: "lat" | "lon" | "alt", value: string) {
    /** parse + validate, then push update via onChange. */
    const v = parseFloat(value);
    if (isNaN(v)) return;
    if (field === "lat" && (v < LAT_BOUNDS.min || v > LAT_BOUNDS.max)) return;
    if (field === "lon" && (v < LON_BOUNDS.min || v > LON_BOUNDS.max)) return;
    // altitude is MSL, can be negative for sub-sea-level airports
    const newLat = field === "lat" ? v : lat;
    const newLon = field === "lon" ? v : lon;
    const newAlt = field === "alt" ? v : alt;
    onChange([newLon, newLat, newAlt]);
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="point-coord-editor">
      <Input
        id="feat-lat"
        label={t("map.coordinates.lat")}
        hint={t("map.coordinates.latHelp")}
        type="number"
        step="0.000001"
        value={String(lat)}
        onChange={(e) => commit("lat", e.target.value)}
      />
      <Input
        id="feat-lon"
        label={t("map.coordinates.lon")}
        hint={t("map.coordinates.lonHelp")}
        type="number"
        step="0.000001"
        value={String(lon)}
        onChange={(e) => commit("lon", e.target.value)}
      />
      <Input
        id="feat-alt"
        label={t("map.coordinates.alt")}
        hint={t("map.coordinates.altHelp")}
        type="number"
        step="0.01"
        value={String(alt)}
        onChange={(e) => commit("alt", e.target.value)}
      />
    </div>
  );
}
