import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { SurfaceResponse, AGLResponse } from "@/types/airport";
import { bulkCreateLHAs } from "@/api/airports";
import { DEFAULT_LHA_SPACING, DEFAULT_LHA_TOLERANCE } from "@/constants/infrastructureDefaults";
import { roundCoord, roundAlt } from "@/utils/coordRounding";

export default function QuickLhaSetup({
  airportId,
  agl,
  surfaces,
  onGenerated,
  pickingLha,
  onPickLhaToggle,
  pickedLhaCoord,
  onPickedLhaConsumed,
}: {
  airportId: string;
  agl: AGLResponse;
  surfaces: SurfaceResponse[];
  onGenerated?: () => Promise<void> | void;
  pickingLha?: "first" | "last" | null;
  onPickLhaToggle?: (which: "first" | "last") => void;
  pickedLhaCoord?: { which: "first" | "last"; lat: number; lon: number; alt: number } | null;
  onPickedLhaConsumed?: () => void;
}) {
  /** collapsible bulk LHA generator - place first/last + spacing, calls backend bulk endpoint. */
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const aglAlt = agl.position.coordinates[2] ?? 0;
  const [firstLat, setFirstLat] = useState("");
  const [firstLon, setFirstLon] = useState("");
  const [firstAlt, setFirstAlt] = useState(String(aglAlt));
  const [lastLat, setLastLat] = useState("");
  const [lastLon, setLastLon] = useState("");
  const [lastAlt, setLastAlt] = useState(String(aglAlt));
  const [spacing, setSpacing] = useState(DEFAULT_LHA_SPACING);
  const [lampType, setLampType] = useState<"HALOGEN" | "LED">("HALOGEN");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [generatedCount, setGeneratedCount] = useState<number | null>(null);

  const surface = surfaces.find((s) => s.id === agl.surface_id);

  // apply incoming picked coord, then notify parent it's consumed
  useEffect(() => {
    if (!pickedLhaCoord) return;
    const lat = String(roundCoord(pickedLhaCoord.lat));
    const lon = String(roundCoord(pickedLhaCoord.lon));
    const alt = String(roundAlt(pickedLhaCoord.alt));
    if (pickedLhaCoord.which === "first") {
      setFirstLat(lat);
      setFirstLon(lon);
      setFirstAlt(alt);
    } else {
      setLastLat(lat);
      setLastLon(lon);
      setLastAlt(alt);
    }
    onPickedLhaConsumed?.();
  }, [pickedLhaCoord, onPickedLhaConsumed]);

  // expand panel automatically when user starts a pick
  useEffect(() => {
    if (pickingLha && !expanded) setExpanded(true);
  }, [pickingLha, expanded]);

  function pickButton(which: "first" | "last") {
    /** render a small pick-on-map button for the given target. */
    if (!onPickLhaToggle) return null;
    const active = pickingLha === which;
    return (
      <button
        type="button"
        onClick={() => onPickLhaToggle(which)}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
          active
            ? "border-tv-accent bg-tv-accent text-tv-accent-text"
            : "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
        }`}
        data-testid={`qls-${which}-pick-map`}
      >
        <MapPin className="h-3 w-3" />
        {t("mission.config.pickOnMap")}
      </button>
    );
  }

  async function handleGenerate() {
    /** submit bulk generation request and surface the resulting count. */
    setErr(null);
    setGeneratedCount(null);

    const fLat = parseFloat(firstLat);
    const fLon = parseFloat(firstLon);
    const fAlt = parseFloat(firstAlt);
    const lLat = parseFloat(lastLat);
    const lLon = parseFloat(lastLon);
    const lAlt = parseFloat(lastAlt);
    const sp = parseFloat(spacing);

    if ([fLat, fLon, fAlt, lLat, lLon, lAlt].some((v) => isNaN(v))) {
      setErr(t("coordinator.agl.quickSetupInvalidPositions"));
      return;
    }
    if (isNaN(sp) || sp <= 0) {
      setErr(t("coordinator.agl.quickSetupInvalidSpacing"));
      return;
    }
    if (!surface) {
      setErr(t("coordinator.agl.quickSetupMissingSurface"));
      return;
    }

    const isEdgeLights = agl.agl_type === "RUNWAY_EDGE_LIGHTS";
    setBusy(true);
    try {
      const res = await bulkCreateLHAs(airportId, surface.id, agl.id, {
        first_position: { type: "Point", coordinates: [fLon, fLat, fAlt] },
        last_position: { type: "Point", coordinates: [lLon, lLat, lAlt] },
        spacing_m: sp,
        setting_angle: isEdgeLights ? 0 : null,
        tolerance: Number(DEFAULT_LHA_TOLERANCE),
        lamp_type: lampType,
      });
      setGeneratedCount(res.generated.length);
      if (onGenerated) await onGenerated();
    } catch (e) {
      setErr(
        e instanceof Error && e.message ? e.message : t("coordinator.agl.quickSetupError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-1 rounded-lg border border-tv-border bg-tv-bg"
      data-testid="quick-lha-setup"
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide"
      >
        <span>{t("coordinator.agl.quickSetup")}</span>
        <span>{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1.5 [&_input]:!px-3 [&_input]:!py-1.5 [&_input]:!text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-tv-text-muted">
              {t("coordinator.agl.placeFirst")}
            </p>
            {pickButton("first")}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              id="qls-first-lat"
              label={t("map.coordinates.lat")}
              hint={t("map.coordinates.latHelp")}
              type="number"
              step="0.000001"
              value={firstLat}
              onChange={(e) => setFirstLat(e.target.value)}
            />
            <Input
              id="qls-first-lon"
              label={t("map.coordinates.lon")}
              hint={t("map.coordinates.lonHelp")}
              type="number"
              step="0.000001"
              value={firstLon}
              onChange={(e) => setFirstLon(e.target.value)}
            />
          </div>
          <Input
            id="qls-first-alt"
            label={t("map.coordinates.alt")}
            hint={t("map.coordinates.altHelp")}
            type="number"
            step="0.01"
            value={firstAlt}
            onChange={(e) => setFirstAlt(e.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-tv-text-muted">
              {t("coordinator.agl.placeLast")}
            </p>
            {pickButton("last")}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              id="qls-last-lat"
              label={t("map.coordinates.lat")}
              hint={t("map.coordinates.latHelp")}
              type="number"
              step="0.000001"
              value={lastLat}
              onChange={(e) => setLastLat(e.target.value)}
            />
            <Input
              id="qls-last-lon"
              label={t("map.coordinates.lon")}
              hint={t("map.coordinates.lonHelp")}
              type="number"
              step="0.000001"
              value={lastLon}
              onChange={(e) => setLastLon(e.target.value)}
            />
          </div>
          <Input
            id="qls-last-alt"
            label={t("map.coordinates.alt")}
            hint={t("map.coordinates.altHelp")}
            type="number"
            step="0.01"
            value={lastAlt}
            onChange={(e) => setLastAlt(e.target.value)}
          />
          <Input
            id="qls-spacing"
            label={t("coordinator.agl.lhaSpacing")}
            hint={t("coordinator.agl.lhaSpacingHelp")}
            type="number"
            step="0.1"
            value={spacing}
            onChange={(e) => setSpacing(e.target.value)}
          />
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("coordinator.detail.lhaLampType")}</span>
              <InfoHint
                text={t("coordinator.detail.lhaLampTypeHelp")}
                label={t("coordinator.detail.lhaLampType")}
                testId="hint-qls-lha-lamp-type"
              />
            </label>
            <select
              value={lampType}
              onChange={(e) => setLampType(e.target.value as "HALOGEN" | "LED")}
              className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            >
              <option value="HALOGEN">{t("coordinator.detail.lampTypes.halogen")}</option>
              <option value="LED">{t("coordinator.detail.lampTypes.led")}</option>
            </select>
          </div>
          {err && <p className="text-[10px] text-tv-error">{err}</p>}
          {generatedCount != null && (
            <p className="text-[10px] text-tv-text-secondary" data-testid="qls-generated-count">
              {t("coordinator.agl.generatedCount", { count: generatedCount })}
            </p>
          )}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-full text-xs font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors disabled:opacity-50"
            data-testid="qls-generate-button"
          >
            {t("coordinator.agl.generateLhas")}
          </button>
        </div>
      )}
    </div>
  );
}
