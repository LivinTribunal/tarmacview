import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import CopyableValue from "@/components/common/CopyableValue";
import { formatLat, formatLon, formatAlt } from "@/utils/coordinates";
import { LAT_BOUNDS, LON_BOUNDS } from "@/constants/geo";
import type { PointZ, PolygonZ } from "@/types/common";

/** single label-value row. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-tv-text-muted whitespace-nowrap">{label}</span>
      <span className="text-tv-text-primary text-right font-medium truncate">
        {value}
      </span>
    </div>
  );
}

/** stacked coordinate display showing lat, lon, alt on separate lines.
 * pass `altRange` (stacked waypoint case) to render the alt row as a
 * "min → max m MSL / min → max m AGL" interval instead of the single point
 * value. the arrow is used in place of a dash so negative pitch / AGL values
 * don't read as a malformed expression (`-7.9° - -3.3°`). */
export function CoordRows({
  position,
  label,
  agl,
  altRange,
  aglRange,
}: {
  position: PointZ;
  label: string;
  agl?: number | null;
  altRange?: { min: number; max: number } | null;
  aglRange?: { min: number; max: number } | null;
}) {
  const { t } = useTranslation();
  const [lon, lat, alt] = position.coordinates;
  const altText = formatAlt(alt ?? 0, 2);
  return (
    <div className="text-xs">
      <div className="text-tv-text-muted">{label}:</div>
      <div className="mt-0.5 pl-2 space-y-0.5">
        <div className="flex justify-between">
          <span className="text-tv-text-muted">{t("map.coordinates.lat")}</span>
          <CopyableValue text={formatLat(lat)} className="font-medium" />
        </div>
        <div className="flex justify-between">
          <span className="text-tv-text-muted">{t("map.coordinates.lon")}</span>
          <CopyableValue text={formatLon(lon)} className="font-medium" />
        </div>
        <div className="flex justify-between">
          <span className="text-tv-text-muted">{t("map.coordinates.alt")}</span>
          {altRange ? (
            <span className="text-tv-text-primary font-medium text-right flex flex-col items-end">
              <span>
                {formatAlt(altRange.min, 2)} → {formatAlt(altRange.max, 2)}
                {t("common.units.m")} {t("mission.config.altMsl")}
              </span>
              {aglRange && (
                <span>
                  {formatAlt(aglRange.min, 2)} → {formatAlt(aglRange.max, 2)}
                  {t("common.units.m")} {t("mission.config.altAgl")}
                </span>
              )}
            </span>
          ) : agl != null ? (
            <span className="text-tv-text-primary font-medium text-right">
              <CopyableValue text={altText}>
                {altText}{t("common.units.m")} {t("mission.config.altMsl")}
              </CopyableValue>
              {" / "}
              <CopyableValue text={formatAlt(agl, 2)}>
                {formatAlt(agl, 2)}{t("common.units.m")} {t("mission.config.altAgl")}
              </CopyableValue>
            </span>
          ) : (
            <CopyableValue
              text={altText}
              className="font-medium"
            >
              {altText}{t("common.units.m")}
            </CopyableValue>
          )}
        </div>
      </div>
    </div>
  );
}

/** polygon centroid + expandable vertex list with altitude. */
export function PolygonCoordRows({
  polygon,
  label,
  defaultExpanded = false,
}: {
  polygon: PolygonZ;
  label: string;
  defaultExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) return null;

  // skip closing vertex if it matches the first
  const vertices = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
    ? ring.slice(0, -1)
    : ring;

  const centLon = vertices.reduce((s, v) => s + v[0], 0) / vertices.length;
  const centLat = vertices.reduce((s, v) => s + v[1], 0) / vertices.length;

  return (
    <div className="text-xs">
      <div className="text-tv-text-muted">{label}:</div>
      <div className="mt-0.5 pl-2 space-y-0.5">
        <div className="text-tv-text-muted text-[10px]">{t("map.centroid")}</div>
        <div className="flex justify-between">
          <span className="text-tv-text-muted">{t("map.coordinates.lat")}</span>
          <CopyableValue text={formatLat(centLat)} className="font-medium" />
        </div>
        <div className="flex justify-between">
          <span className="text-tv-text-muted">{t("map.coordinates.lon")}</span>
          <CopyableValue text={formatLon(centLon)} className="font-medium" />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-1 flex items-center gap-1 text-tv-text-muted hover:text-tv-text-secondary transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "" : "-rotate-90"}`} />
        <span>{t("map.vertices")} ({vertices.length})</span>
      </button>
      {expanded && (
        <div className="pl-2 mt-0.5 space-y-1 max-h-40 overflow-y-auto">
          {vertices.map((v, i) => {
            const vLat = formatLat(v[1]);
            const vLon = formatLon(v[0]);
            const vAlt = formatAlt(v[2] ?? 0, 2);
            return (
              <div key={i} className="flex justify-between gap-2">
                <span className="text-tv-text-muted">#{i + 1}</span>
                <CopyableValue
                  text={`${vLat}, ${vLon}, ${vAlt}`}
                  className="font-medium tabular-nums text-right"
                >
                  {vLat}, {vLon}, {vAlt}{t("common.units.m")}
                </CopyableValue>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** editable coordinate fields with inline inputs. */
export function EditableCoordRows({
  position,
  label,
  onSave,
  agl,
}: {
  position: PointZ;
  label: string;
  onSave: (lat: number, lon: number, alt: number) => void;
  agl?: number | null;
}) {
  const { t } = useTranslation();
  const [lon, lat, alt] = position.coordinates;
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = useCallback((field: string, value: number) => {
    setEditingField(field);
    setEditValue(String(value));
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingField) return;
    const parsed = parseFloat(editValue);
    if (isNaN(parsed)) {
      setEditingField(null);
      return;
    }

    if (editingField === "lat" && (parsed < LAT_BOUNDS.min || parsed > LAT_BOUNDS.max)) {
      setEditingField(null);
      return;
    }
    if (editingField === "lon" && (parsed < LON_BOUNDS.min || parsed > LON_BOUNDS.max)) {
      setEditingField(null);
      return;
    }

    const newLat = editingField === "lat" ? parsed : lat;
    const newLon = editingField === "lon" ? parsed : lon;
    const newAlt = editingField === "alt" ? parsed : alt;
    onSave(newLat, newLon, newAlt);
    setEditingField(null);
  }, [editingField, editValue, lat, lon, alt, onSave]);

  function formatField(fieldName: string, value: number): string {
    /** display formatting per field - lat/lon 9 dp, alt 1 dp. */
    if (fieldName === "lat") return formatLat(value);
    if (fieldName === "lon") return formatLon(value);
    return formatAlt(value, 1);
  }

  function renderField(
    fieldName: string,
    fieldLabel: string,
    value: number,
    aglValue?: number | null,
  ) {
    if (editingField === fieldName) {
      return (
        <div className="flex justify-between items-center">
          <span className="text-tv-text-muted">{fieldLabel}</span>
          <input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            aria-label={fieldLabel}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditingField(null);
            }}
            className="w-24 text-right text-xs font-medium bg-tv-bg border border-tv-accent rounded px-1 py-0.5 outline-none text-tv-text-primary"
            autoFocus
          />
        </div>
      );
    }
    return (
      <div className="flex justify-between">
        <span className="text-tv-text-muted">{fieldLabel}</span>
        <span className="text-tv-text-primary font-medium text-right">
          <button
            type="button"
            onClick={() => startEdit(fieldName, value)}
            className="hover:text-tv-accent transition-colors cursor-text"
            title={t("common.edit")}
          >
            {formatField(fieldName, value)}{fieldName === "alt" ? t("common.units.m") : ""}
          </button>
          {fieldName === "alt" &&
            aglValue != null &&
            ` ${t("mission.config.altMsl")} / ${formatAlt(aglValue, 1)}${t("common.units.m")} ${t("mission.config.altAgl")}`}
        </span>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <div className="text-tv-text-muted">{label}:</div>
      <div className="mt-0.5 pl-2 space-y-0.5">
        {renderField("lat", t("map.coordinates.lat"), lat)}
        {renderField("lon", t("map.coordinates.lon"), lon)}
        {renderField("alt", t("map.coordinates.alt"), alt, agl)}
      </div>
    </div>
  );
}

/** delete button for takeoff/landing with confirmation. */
export function DeleteButton({
  waypointType,
  onDelete,
}: {
  waypointType: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="mt-2 space-y-1.5">
        <p className="text-xs text-tv-text-secondary">
          {t("map.deleteConfirm", { type: waypointType.toLowerCase() })}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-error text-tv-error hover:bg-tv-error hover:text-white transition-colors"
          >
            {t("common.delete")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="mt-2 w-full rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-error text-tv-error hover:bg-tv-error hover:text-white transition-colors"
      data-testid="delete-waypoint-btn"
    >
      {t("common.delete")} {waypointType.toLowerCase()}
    </button>
  );
}
