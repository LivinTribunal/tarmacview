import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Film, GripVertical, Loader2, Play, Trash2, Upload } from "lucide-react";
import Modal from "@/components/common/Modal";
import MeasurementFlowDialog from "./MeasurementFlowDialog";
import {
  completeDroneMediaUpload,
  deleteDroneMedia,
  listMissionDroneMedia,
  moveDroneMedia,
  reorderInspectionMedia,
  requestUploadUrl,
  uploadToPresignedUrl,
} from "@/api/droneMedia";
import { createMeasurement } from "@/api/measurements";
import type {
  DroneMediaFileResponse,
  MissionInspectionMediaResponse,
} from "@/types/droneMedia";

interface UploadDroneMediaDialogProps {
  isOpen: boolean;
  onClose: () => void;
  missionId: string;
}

const UNASSIGNED_CONTAINER = "unassigned";
const INSPECTION_PREFIX = "inspection:";

interface Container {
  id: string;
  inspectionId: string | null;
  label: string;
  files: DroneMediaFileResponse[];
}

/** filename tail of a media object key. */
function fileName(objectKey: string): string {
  return objectKey.split("/").pop() ?? objectKey;
}

/** human-readable file size, blank when unknown. */
function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** apply a new id order to one inspection group, renumbering order_index 1..N. */
function applyReorder(
  media: MissionInspectionMediaResponse,
  inspectionId: string,
  orderedIds: string[],
): MissionInspectionMediaResponse {
  return {
    ...media,
    inspections: media.inspections.map((group) => {
      if (group.inspection_id !== inspectionId) return group;
      const byId = new Map(group.files.map((f) => [f.id, f]));
      const files = orderedIds.flatMap((id, i) => {
        const file = byId.get(id);
        return file ? [{ ...file, order_index: i + 1 }] : [];
      });
      return { ...group, files };
    }),
  };
}

/** find one media file across every inspection group and the unassigned bucket. */
function findFile(
  media: MissionInspectionMediaResponse,
  fileId: string,
): DroneMediaFileResponse | null {
  for (const group of media.inspections) {
    const hit = group.files.find((f) => f.id === fileId);
    if (hit) return hit;
  }
  return media.unassigned.find((f) => f.id === fileId) ?? null;
}

/** move one file to another inspection / position (or the unassigned bucket),
 *  re-densifying both the source and destination groups. */
function applyMove(
  media: MissionInspectionMediaResponse,
  fileId: string,
  targetInspectionId: string | null,
  orderIndex: number | null,
): MissionInspectionMediaResponse {
  const moved = findFile(media, fileId);
  if (!moved) return media;

  // pull the file out of wherever it sits, renumbering each group 1..N
  const stripped: MissionInspectionMediaResponse = {
    ...media,
    inspections: media.inspections.map((group) => ({
      ...group,
      files: group.files
        .filter((f) => f.id !== fileId)
        .map((f, i) => ({ ...f, order_index: i + 1 })),
    })),
    unassigned: media.unassigned.filter((f) => f.id !== fileId),
  };

  if (targetInspectionId === null) {
    return {
      ...stripped,
      unassigned: [...stripped.unassigned, { ...moved, inspection_id: null, order_index: null }],
    };
  }

  return {
    ...stripped,
    inspections: stripped.inspections.map((group) => {
      if (group.inspection_id !== targetInspectionId) return group;
      const files = group.files.slice();
      const pos =
        orderIndex == null
          ? files.length
          : Math.min(Math.max(orderIndex - 1, 0), files.length);
      files.splice(pos, 0, { ...moved, inspection_id: targetInspectionId });
      return { ...group, files: files.map((f, i) => ({ ...f, order_index: i + 1 })) };
    }),
  };
}

/** drop one file from wherever it sits, renumbering its inspection group 1..N. */
function applyDelete(
  media: MissionInspectionMediaResponse,
  fileId: string,
): MissionInspectionMediaResponse {
  return {
    ...media,
    inspections: media.inspections.map((group) =>
      group.files.some((f) => f.id === fileId)
        ? {
            ...group,
            files: group.files
              .filter((f) => f.id !== fileId)
              .map((f, i) => ({ ...f, order_index: i + 1 })),
          }
        : group,
    ),
    unassigned: media.unassigned.filter((f) => f.id !== fileId),
  };
}

const FILE_ROW_CLASS =
  "flex items-center gap-2 py-1.5 px-2 rounded-lg border border-tv-border bg-tv-bg";

/** the shared visual body of a media row (order badge, icon, name, size). */
function FileRowBody({ file }: { file: DroneMediaFileResponse }) {
  return (
    <>
      {file.order_index != null && (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-tv-surface-hover text-xs font-semibold text-tv-text-secondary">
          {file.order_index}
        </span>
      )}
      <Film className="h-4 w-4 text-tv-text-secondary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-tv-text-primary truncate">
          {file.filename ?? fileName(file.object_key)}
        </p>
        {file.size_bytes != null && (
          <p className="text-xs text-tv-text-secondary">{formatSize(file.size_bytes)}</p>
        )}
      </div>
    </>
  );
}

/** one draggable media row inside a container. */
function SortableFileRow({
  file,
  dragLabel,
  deleteLabel,
  onDelete,
}: {
  file: DroneMediaFileResponse;
  dragLabel: string;
  deleteLabel: string;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: file.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} data-testid={`media-file-${file.id}`} className={FILE_ROW_CLASS}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={dragLabel}
        data-testid={`media-drag-${file.id}`}
        className="cursor-grab text-tv-text-secondary hover:text-tv-text-primary"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <FileRowBody file={file} />
      {file.origin === "MANUAL" && (
        <button
          type="button"
          onClick={() => onDelete(file.id)}
          aria-label={deleteLabel}
          title={deleteLabel}
          data-testid={`media-delete-${file.id}`}
          className="shrink-0 text-tv-text-secondary hover:text-tv-error"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** a static clone of a media row that follows the cursor while dragging. */
function DragPreviewRow({ file }: { file: DroneMediaFileResponse }) {
  return (
    <div className={`${FILE_ROW_CLASS} shadow-lg`}>
      <GripVertical className="h-4 w-4 text-tv-text-secondary" />
      <FileRowBody file={file} />
    </div>
  );
}

/** droppable wrapper that highlights when a dragged file hovers over it. */
function DroppableContainer({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-1.5 rounded-xl p-2 transition-colors ${
        isOver ? "bg-tv-surface-hover ring-1 ring-inset ring-tv-accent" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** drop-or-browse zone that uploads selected files into one inspection. */
function UploadZone({
  inspectionId,
  busy,
  label,
  onFiles,
}: {
  inspectionId: string;
  busy: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className="flex items-center justify-center rounded-lg border border-dashed border-tv-border py-2"
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        data-testid={`media-upload-input-${inspectionId}`}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 text-xs font-semibold text-tv-text-secondary hover:text-tv-text-primary disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-tv-accent" />
        ) : (
          <Upload className="h-4 w-4" />
        )}
        {label}
      </button>
    </div>
  );
}

/** per-inspection drone-media upload form: drop, reorder, and move between inspections. */
export default function UploadDroneMediaDialog({
  isOpen,
  onClose,
  missionId,
}: UploadDroneMediaDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [media, setMedia] = useState<MissionInspectionMediaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyContainer, setBusyContainer] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [measureTarget, setMeasureTarget] = useState<{
    inspectionId: string;
    label: string;
  } | null>(null);
  // fire-all batch: started/failed tally surfaced after "Measure all"
  const [batchStarting, setBatchStarting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    started: number;
    failed: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // spinner only on the first load - action-triggered refetches reconcile
  // silently so the list never blanks mid-reorder
  const fetchData = useCallback(
    async ({ spinner = false }: { spinner?: boolean } = {}) => {
      if (spinner) setIsLoading(true);
      setError(null);
      try {
        setMedia(await listMissionDroneMedia(missionId));
      } catch {
        setError(t("mission.uploadDroneMediaDialog.loadError"));
      } finally {
        if (spinner) setIsLoading(false);
      }
    },
    [missionId, t],
  );

  useEffect(() => {
    if (isOpen) {
      setBatchResult(null);
      void fetchData({ spinner: true });
    }
  }, [isOpen, fetchData]);

  const containers: Container[] = useMemo(() => {
    if (!media) return [];
    const list: Container[] = media.inspections.map((group) => ({
      id: `${INSPECTION_PREFIX}${group.inspection_id}`,
      inspectionId: group.inspection_id,
      label: t("mission.uploadDroneMediaDialog.inspectionLabel", {
        order: group.sequence_order,
        method: group.method,
      }),
      files: group.files,
    }));
    list.push({
      id: UNASSIGNED_CONTAINER,
      inspectionId: null,
      label: t("mission.uploadDroneMediaDialog.unassigned"),
      files: media.unassigned,
    });
    return list;
  }, [media, t]);

  const itemContainer = useMemo(() => {
    const map = new Map<string, Container>();
    for (const container of containers) {
      for (const file of container.files) map.set(file.id, container);
    }
    return map;
  }, [containers]);

  const resolveContainer = useCallback(
    (id: string): Container | null =>
      containers.find((c) => c.id === id) ?? itemContainer.get(id) ?? null,
    [containers, itemContainer],
  );

  // inspections holding at least one uploaded clip - the fire-all batch targets these
  const inspectionsWithMedia = useMemo(
    () => media?.inspections.filter((group) => group.files.length > 0) ?? [],
    [media],
  );

  async function handleUpload(inspectionId: string, files: File[]) {
    if (files.length === 0) return;
    const key = `${INSPECTION_PREFIX}${inspectionId}`;
    setBusyContainer(key);
    setError(null);
    try {
      for (const file of files) {
        const { object_key, upload_url } = await requestUploadUrl(
          file.name,
          file.type || null,
        );
        await uploadToPresignedUrl(upload_url, file);
        await completeDroneMediaUpload({
          missionId,
          inspectionId,
          objectKey: object_key,
          filename: file.name,
          sizeBytes: file.size,
        });
      }
      await fetchData();
    } catch {
      setError(t("mission.uploadDroneMediaDialog.uploadError"));
    } finally {
      setBusyContainer(null);
    }
  }

  async function handleDelete(fileId: string) {
    // optimistically drop the row so it vanishes immediately, then reconcile
    setMedia((prev) => (prev ? applyDelete(prev, fileId) : prev));
    try {
      await deleteDroneMedia(fileId);
    } catch {
      setError(t("mission.uploadDroneMediaDialog.deleteError"));
    }
    await fetchData();
  }

  // fire one run per inspection-with-media at once - a single bad inspection must
  // not abort the rest, so settle every call and tally started vs failed. the
  // operator triages any AWAITING_CONFIRM runs from the measurements list.
  async function handleMeasureAll() {
    if (inspectionsWithMedia.length === 0 || batchStarting) return;
    setBatchStarting(true);
    setBatchResult(null);
    const results = await Promise.allSettled(
      inspectionsWithMedia.map((group) => createMeasurement(group.inspection_id)),
    );
    const started = results.filter((r) => r.status === "fulfilled").length;
    setBatchResult({ started, failed: results.length - started });
    setBatchStarting(false);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const draggedId = String(active.id);
    const overId = String(over.id);

    const source = itemContainer.get(draggedId);
    const target = resolveContainer(overId);
    if (!source || !target) return;

    if (source.id === target.id) {
      // reorder within an inspection (the unassigned bucket carries no order)
      if (target.inspectionId === null) return;
      const inspectionId = target.inspectionId;
      const ids = target.files.map((f) => f.id);
      const oldIndex = ids.indexOf(draggedId);
      const newIndex = overId === target.id ? ids.length - 1 : ids.indexOf(overId);
      if (oldIndex === newIndex || newIndex < 0) return;
      const ordered = arrayMove(ids, oldIndex, newIndex);
      // optimistically apply the new order so the dragged row stays put instead
      // of snapping back to its old slot while the reorder request round-trips
      setMedia((prev) => (prev ? applyReorder(prev, inspectionId, ordered) : prev));
      try {
        await reorderInspectionMedia(inspectionId, ordered);
      } catch {
        setError(t("mission.uploadDroneMediaDialog.reorderError"));
      }
      await fetchData();
      return;
    }

    // move across containers - null inspection detaches to the unassigned bucket
    let orderIndex: number | null = null;
    if (target.inspectionId !== null) {
      const ids = target.files.map((f) => f.id);
      const overIndex = overId === target.id ? ids.length : ids.indexOf(overId);
      orderIndex = (overIndex < 0 ? ids.length : overIndex) + 1;
    }
    // optimistically land the row in its new group so it doesn't jump back to
    // the source while the move request round-trips
    const targetInspectionId = target.inspectionId;
    setMedia((prev) => (prev ? applyMove(prev, draggedId, targetInspectionId, orderIndex) : prev));
    try {
      await moveDroneMedia(draggedId, targetInspectionId, orderIndex);
    } catch {
      setError(t("mission.uploadDroneMediaDialog.moveError"));
    }
    await fetchData();
  }

  const hasInspections = media !== null && media.inspections.length > 0;
  const activeFile = activeId
    ? (itemContainer.get(activeId)?.files.find((f) => f.id === activeId) ?? null)
    : null;

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("mission.uploadDroneMediaDialog.title")}
    >
      <div
        className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto"
        data-testid="upload-drone-media-dialog"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-tv-accent" />
          </div>
        )}

        {error && <p className="text-xs text-tv-error">{error}</p>}

        {!isLoading && hasInspections && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={inspectionsWithMedia.length === 0 || batchStarting}
                onClick={handleMeasureAll}
                data-testid="measure-all"
                className="flex items-center gap-1.5 rounded-lg bg-tv-accent px-3 py-1.5 text-xs font-semibold text-tv-accent-text hover:opacity-90 disabled:opacity-50"
              >
                {batchStarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {batchStarting
                  ? t("mission.uploadDroneMediaDialog.measuringAll")
                  : t("mission.uploadDroneMediaDialog.measureAll")}
              </button>
              {batchResult !== null && batchResult.started > 0 && (
                <button
                  type="button"
                  onClick={() => navigate("/operator-center/measurements")}
                  data-testid="review-in-results"
                  className="text-xs font-semibold text-tv-accent hover:underline"
                >
                  {t("mission.uploadDroneMediaDialog.reviewInResults")}
                </button>
              )}
            </div>
            {batchResult !== null && (
              <p
                className={`text-xs ${
                  batchResult.started === 0 ? "text-tv-error" : "text-tv-text-secondary"
                }`}
                data-testid="measure-all-result"
              >
                {batchResult.started === 0
                  ? t("mission.uploadDroneMediaDialog.measureAllError")
                  : batchResult.failed > 0
                    ? t("mission.uploadDroneMediaDialog.measureAllPartial", {
                        started: batchResult.started,
                        total: batchResult.started + batchResult.failed,
                        failed: batchResult.failed,
                      })
                    : t("mission.uploadDroneMediaDialog.measureAllStarted", {
                        count: batchResult.started,
                      })}
              </p>
            )}
          </div>
        )}

        {!isLoading && media !== null && !hasInspections && (
          <p className="text-sm text-tv-text-secondary py-4">
            {t("mission.uploadDroneMediaDialog.noInspections")}
          </p>
        )}

        {!isLoading && media !== null && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setActiveId(String(e.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            {containers.map((container) => (
              <section
                key={container.id}
                data-testid={
                  container.inspectionId
                    ? `media-group-${container.inspectionId}`
                    : "media-group-unassigned"
                }
              >
                <div className="flex items-center justify-between mb-1 px-2">
                  <h3 className="text-sm font-semibold text-tv-text-primary">
                    {container.label}
                    <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-tv-surface-hover text-tv-text-secondary">
                      {t("mission.uploadDroneMediaDialog.fileCount", {
                        count: container.files.length,
                      })}
                    </span>
                  </h3>
                  {container.inspectionId !== null && container.files.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setMeasureTarget({
                          inspectionId: container.inspectionId!,
                          label: container.label,
                        })
                      }
                      data-testid={`measure-${container.inspectionId}`}
                      className="flex items-center gap-1 rounded-lg bg-tv-accent px-2.5 py-1 text-xs font-semibold text-tv-accent-text hover:opacity-90"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t("mission.uploadDroneMediaDialog.measure")}
                    </button>
                  )}
                </div>
                <DroppableContainer id={container.id}>
                  <SortableContext
                    items={container.files.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {container.files.length === 0 && (
                      <p className="text-xs text-tv-text-secondary px-2 py-1">
                        {t("mission.uploadDroneMediaDialog.emptyGroup")}
                      </p>
                    )}
                    {container.files.map((file) => (
                      <SortableFileRow
                        key={file.id}
                        file={file}
                        dragLabel={t("mission.uploadDroneMediaDialog.dragHandle")}
                        deleteLabel={t("mission.uploadDroneMediaDialog.deleteFile")}
                        onDelete={handleDelete}
                      />
                    ))}
                  </SortableContext>
                  {container.inspectionId !== null && (
                    <UploadZone
                      inspectionId={container.inspectionId}
                      busy={busyContainer === container.id}
                      label={
                        busyContainer === container.id
                          ? t("mission.uploadDroneMediaDialog.uploading")
                          : t("mission.uploadDroneMediaDialog.dropOrBrowse")
                      }
                      onFiles={(files) => handleUpload(container.inspectionId!, files)}
                    />
                  )}
                </DroppableContainer>
              </section>
            ))}
            <DragOverlay dropAnimation={null}>
              {activeFile ? <DragPreviewRow file={activeFile} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </Modal>
    {measureTarget && (
      <MeasurementFlowDialog
        key={measureTarget.inspectionId}
        inspectionId={measureTarget.inspectionId}
        inspectionLabel={measureTarget.label}
        onClose={() => setMeasureTarget(null)}
      />
    )}
    </>
  );
}
