import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Upload, Loader2, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { extractPhotoMetadata } from "@/api/airports";
import { isAxiosError } from "@/api/client";
import type { PhotoMetadataItem } from "@/types/airport";
import { orderPolygonRing, pointsToPolygon } from "@/utils/orderPolygonRing";

// the subset of creation entity types a handoff can pre-select.
export type ExtractorEntityHint = "agl" | "lha" | "obstacle" | "runway";

export interface LensHeights {
  msl: number | null;
  agl: number | null;
}

// what the extractor hands to the creation system on confirm. the extractor
// itself never writes to the db - it pre-fills the existing creation panel.
export type ExtractorHandoff =
  | { kind: "point"; position: [number, number]; entityType?: ExtractorEntityHint; lens?: LensHeights }
  | {
      kind: "points";
      positions: [number, number][];
      entityType: ExtractorEntityHint;
      lensPerPoint?: (LensHeights | null)[];
    }
  | { kind: "polygon"; polygon: GeoJSON.Polygon; entityType: ExtractorEntityHint };

interface ImageMetadataExtractorModalProps {
  isOpen: boolean;
  onClose: () => void;
  airportId: string;
  onHandoff: (handoff: ExtractorHandoff) => void;
}

// target choices that map cleanly onto the existing creation seams. point
// targets consume one point each; polygon targets consume all points as an
// ordered ring.
type TargetKind = "point" | "points" | "polygon";

interface TargetOption {
  id: string;
  labelKey: string;
  kind: TargetKind;
  entityType: ExtractorEntityHint;
}

/** the count -> target mapping. n = number of geotagged points. */
function targetOptionsForCount(n: number): TargetOption[] {
  if (n === 1) {
    return [
      { id: "agl", labelKey: "coordinator.imageExtractor.targets.agl", kind: "point", entityType: "agl" },
      { id: "lha", labelKey: "coordinator.imageExtractor.targets.aglUnit", kind: "point", entityType: "lha" },
    ];
  }
  if (n === 2) {
    return [
      { id: "lha_units", labelKey: "coordinator.imageExtractor.targets.aglUnits", kind: "points", entityType: "lha" },
    ];
  }
  if (n === 3) {
    return [
      { id: "lha_units", labelKey: "coordinator.imageExtractor.targets.aglUnits", kind: "points", entityType: "lha" },
      { id: "obstacle", labelKey: "coordinator.imageExtractor.targets.obstacle", kind: "polygon", entityType: "obstacle" },
    ];
  }
  return [
    { id: "surface", labelKey: "coordinator.imageExtractor.targets.surface", kind: "polygon", entityType: "runway" },
    { id: "obstacle", labelKey: "coordinator.imageExtractor.targets.obstacle", kind: "polygon", entityType: "obstacle" },
    { id: "lha_units", labelKey: "coordinator.imageExtractor.targets.aglUnits", kind: "points", entityType: "lha" },
  ];
}

interface LensEdit {
  msl: string;
  agl: string;
}

/** "extract from image" dialog: upload drone photos, review extracted coordinates, hand off to creation. */
export default function ImageMetadataExtractorModal({
  isOpen,
  onClose,
  airportId,
  onHandoff,
}: ImageMetadataExtractorModalProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PhotoMetadataItem[]>([]);
  const [hasDem, setHasDem] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [lensEdits, setLensEdits] = useState<Record<number, LensEdit>>({});
  const [vertexOrder, setVertexOrder] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setItems([]);
      setHasDem(false);
      setLoading(false);
      setError(null);
      setDragOver(false);
      setTargetId("");
      setLensEdits({});
      setVertexOrder([]);
    }
  }, [isOpen]);

  // geotagged items (those with coordinates) keep their index into `items`
  const geoItems = useMemo(
    () => items.map((item, idx) => ({ item, idx })).filter((e) => e.item.coordinates !== null),
    [items],
  );
  const pointCount = geoItems.length;
  const targetOptions = useMemo(() => targetOptionsForCount(pointCount), [pointCount]);
  const selectedTarget = targetOptions.find((o) => o.id === targetId) ?? null;

  // default the chosen target to the first option when the point count changes
  useEffect(() => {
    if (targetOptions.length > 0) {
      setTargetId((prev) => (targetOptions.some((o) => o.id === prev) ? prev : targetOptions[0].id));
    } else {
      setTargetId("");
    }
  }, [targetOptions]);

  // seed the vertex order from polar-angle ordering when geotagged points change
  useEffect(() => {
    const ordered = orderPolygonRing(geoItems.map((e) => coordOf(e.item)));
    // map ordered [lon,lat] back to their geoItems positions
    const order = ordered.map((pt) =>
      geoItems.findIndex((e) => {
        const c = coordOf(e.item);
        return c[0] === pt[0] && c[1] === pt[1];
      }),
    );
    setVertexOrder(order.filter((i) => i >= 0));
  }, [geoItems]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      /** upload the chosen images and load the extracted metadata. */
      if (files.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const res = await extractPhotoMetadata(airportId, files);
        setItems(res.items);
        setHasDem(res.has_dem);
        const edits: Record<number, LensEdit> = {};
        res.items.forEach((item, idx) => {
          edits[idx] = {
            msl: item.lens_height_msl_m != null ? String(item.lens_height_msl_m) : "",
            agl: item.lens_height_agl_m != null ? String(item.lens_height_agl_m) : "",
          };
        });
        setLensEdits(edits);
      } catch (err) {
        // a 403 is an airport-access problem, not a bad image - say so plainly
        setError(
          isAxiosError(err) && err.response?.status === 403
            ? t("coordinator.imageExtractor.noAccess")
            : t("coordinator.imageExtractor.extractError"),
        );
      } finally {
        setLoading(false);
      }
    },
    [airportId, t],
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    /** pull files off the picker and reset the input. */
    const files = Array.from(e.target.files ?? []);
    handleFiles(files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    /** accept dropped image files. */
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    handleFiles(files);
  }

  function moveVertex(position: number, delta: number) {
    /** swap a vertex with its neighbour to manually reorder the ring. */
    setVertexOrder((prev) => {
      const next = [...prev];
      const target = position + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[position], next[target]] = [next[target], next[position]];
      return next;
    });
  }

  const lensFor = useCallback(
    (idx: number): LensHeights => {
      const edit = lensEdits[idx];
      const mslNum = edit && edit.msl !== "" ? parseFloat(edit.msl) : NaN;
      const aglNum = edit && edit.agl !== "" ? parseFloat(edit.agl) : NaN;
      return {
        msl: isNaN(mslNum) ? null : mslNum,
        agl: isNaN(aglNum) ? null : aglNum,
      };
    },
    [lensEdits],
  );

  function handleConfirm() {
    /** translate the chosen target into a handoff and close. */
    if (!selectedTarget) return;
    if (selectedTarget.kind === "point") {
      const { item, idx } = geoItems[0];
      const c = coordOf(item);
      onHandoff({
        kind: "point",
        position: c,
        entityType: selectedTarget.entityType,
        lens: selectedTarget.entityType === "lha" ? lensFor(idx) : undefined,
      });
    } else if (selectedTarget.kind === "points") {
      onHandoff({
        kind: "points",
        positions: geoItems.map((e) => coordOf(e.item)),
        entityType: selectedTarget.entityType,
        lensPerPoint:
          selectedTarget.entityType === "lha" ? geoItems.map((e) => lensFor(e.idx)) : undefined,
      });
    } else {
      // polygon: use the manually-ordered ring
      const orderedPts = vertexOrder.map((gi) => coordOf(geoItems[gi].item));
      onHandoff({
        kind: "polygon",
        polygon: pointsToPolygon(orderedPts),
        entityType: selectedTarget.entityType,
      });
    }
    onClose();
  }

  const canConfirm = pointCount > 0 && selectedTarget !== null;
  const isPolygonTarget = selectedTarget?.kind === "polygon";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("coordinator.imageExtractor.title")}>
      {/* drop zone + picker */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 text-center transition-colors ${
          dragOver ? "border-tv-accent bg-tv-surface-hover" : "border-tv-border bg-tv-bg"
        }`}
        data-testid="image-extractor-dropzone"
      >
        <Upload className="h-5 w-5 text-tv-text-muted" />
        <p className="text-xs text-tv-text-secondary">{t("coordinator.imageExtractor.dropHint")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleInputChange}
          className="hidden"
          data-testid="image-extractor-input"
        />
        <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={loading}>
          {t("coordinator.imageExtractor.choose")}
        </Button>
      </div>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-tv-text-secondary" data-testid="image-extractor-loading">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("coordinator.imageExtractor.extracting")}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-tv-error">{error}</p>}

      {items.length > 0 && !loading && (
        <>
          {/* review list */}
          <div className="mt-3 max-h-56 overflow-y-auto flex flex-col gap-2" data-testid="image-extractor-review">
            {items.map((item, idx) => {
              const c = item.coordinates?.coordinates;
              return (
                <div
                  key={`${item.filename}-${idx}`}
                  className="rounded-xl border border-tv-border bg-tv-bg p-2"
                  data-testid="image-extractor-item"
                >
                  <p className="text-xs font-medium text-tv-text-primary truncate">{item.filename}</p>
                  {c ? (
                    <>
                      <p className="text-[10px] text-tv-text-muted">
                        {t("map.coordinates.lat")}: {c[1].toFixed(6)} · {t("map.coordinates.lon")}: {c[0].toFixed(6)} · {c[2].toFixed(1)} m
                      </p>
                      {selectedTarget?.entityType === "lha" && (
                        <div className="mt-1 flex gap-2">
                          <label className="flex-1 text-[10px] text-tv-text-secondary">
                            {t("coordinator.imageExtractor.lensMsl")}
                            <input
                              type="number"
                              step="0.01"
                              value={lensEdits[idx]?.msl ?? ""}
                              onChange={(e) =>
                                setLensEdits((prev) => ({ ...prev, [idx]: { ...prev[idx], msl: e.target.value, agl: prev[idx]?.agl ?? "" } }))
                              }
                              className="w-full mt-0.5 px-2 py-1 rounded-lg text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent"
                              data-testid={`image-extractor-lens-msl-${idx}`}
                            />
                          </label>
                          <label className="flex-1 text-[10px] text-tv-text-secondary">
                            {t("coordinator.imageExtractor.lensAgl")}
                            <input
                              type="number"
                              step="0.01"
                              value={lensEdits[idx]?.agl ?? ""}
                              onChange={(e) =>
                                setLensEdits((prev) => ({ ...prev, [idx]: { ...prev[idx], agl: e.target.value, msl: prev[idx]?.msl ?? "" } }))
                              }
                              className="w-full mt-0.5 px-2 py-1 rounded-lg text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent"
                              data-testid={`image-extractor-lens-agl-${idx}`}
                            />
                          </label>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="flex items-center gap-1 text-[10px] text-tv-warning" data-testid="image-extractor-nogps">
                      <AlertTriangle className="h-3 w-3" />
                      {t("coordinator.imageExtractor.noGps")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {selectedTarget?.entityType === "lha" && !hasDem && (
            <p className="mt-1 text-[10px] text-tv-text-muted">{t("coordinator.imageExtractor.noDem")}</p>
          )}

          {/* target selection */}
          {pointCount > 0 ? (
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1 text-tv-text-secondary">
                {t("coordinator.imageExtractor.createAs")}
              </label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
                data-testid="image-extractor-target"
              >
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t(o.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-3 text-xs text-tv-error" data-testid="image-extractor-no-points">
              {t("coordinator.imageExtractor.noPoints")}
            </p>
          )}

          {/* vertex reorder for polygon targets */}
          {isPolygonTarget && vertexOrder.length >= 3 && (
            <div className="mt-3" data-testid="image-extractor-vertex-order">
              <label className="block text-xs font-medium mb-1 text-tv-text-secondary">
                {t("coordinator.imageExtractor.vertexOrder")}
              </label>
              <div className="flex flex-col gap-1">
                {vertexOrder.map((gi, pos) => (
                  <div key={gi} className="flex items-center justify-between rounded-lg border border-tv-border bg-tv-bg px-2 py-1">
                    <span className="text-[10px] text-tv-text-primary truncate">
                      {pos + 1}. {geoItems[gi]?.item.filename}
                    </span>
                    <span className="flex gap-1">
                      <button
                        onClick={() => moveVertex(pos, -1)}
                        disabled={pos === 0}
                        className="p-0.5 text-tv-text-muted hover:text-tv-text-primary disabled:opacity-30"
                        aria-label={t("coordinator.imageExtractor.moveUp")}
                        data-testid={`image-extractor-move-up-${pos}`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveVertex(pos, 1)}
                        disabled={pos === vertexOrder.length - 1}
                        className="p-0.5 text-tv-text-muted hover:text-tv-text-primary disabled:opacity-30"
                        aria-label={t("coordinator.imageExtractor.moveDown")}
                        data-testid={`image-extractor-move-down-${pos}`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleConfirm} disabled={!canConfirm}>
          {t("coordinator.imageExtractor.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

/** pull a [lon, lat] pair off a geotagged item. */
function coordOf(item: PhotoMetadataItem): [number, number] {
  const c = item.coordinates!.coordinates;
  return [c[0], c[1]];
}
