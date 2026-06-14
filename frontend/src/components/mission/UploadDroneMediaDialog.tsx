import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { Film, GripVertical, Loader2, Upload } from "lucide-react";
import Modal from "@/components/common/Modal";
import {
  completeDroneMediaUpload,
  listMissionDroneMedia,
  moveDroneMedia,
  reorderInspectionMedia,
  requestUploadUrl,
  uploadToPresignedUrl,
} from "@/api/droneMedia";
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

/** one draggable media row inside a container. */
function SortableFileRow({
  file,
  dragLabel,
}: {
  file: DroneMediaFileResponse;
  dragLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: file.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`media-file-${file.id}`}
      className="flex items-center gap-2 py-1.5 px-2 rounded-lg border border-tv-border bg-tv-bg"
    >
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
        isOver ? "bg-tv-surface-hover ring-1 ring-tv-accent" : ""
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
  const [media, setMedia] = useState<MissionInspectionMediaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyContainer, setBusyContainer] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMedia(await listMissionDroneMedia(missionId));
    } catch {
      setError(t("mission.uploadDroneMediaDialog.loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [missionId, t]);

  useEffect(() => {
    if (isOpen) void fetchData();
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

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const source = itemContainer.get(activeId);
    const target = resolveContainer(overId);
    if (!source || !target) return;

    if (source.id === target.id) {
      // reorder within an inspection (the unassigned bucket carries no order)
      if (target.inspectionId === null) return;
      const ids = target.files.map((f) => f.id);
      const oldIndex = ids.indexOf(activeId);
      const newIndex = overId === target.id ? ids.length - 1 : ids.indexOf(overId);
      if (oldIndex === newIndex || newIndex < 0) return;
      const ordered = arrayMove(ids, oldIndex, newIndex);
      try {
        await reorderInspectionMedia(target.inspectionId, ordered);
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
    try {
      await moveDroneMedia(activeId, target.inspectionId, orderIndex);
    } catch {
      setError(t("mission.uploadDroneMediaDialog.moveError"));
    }
    await fetchData();
  }

  const hasInspections = media !== null && media.inspections.length > 0;

  return (
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

        {!isLoading && media !== null && !hasInspections && (
          <p className="text-sm text-tv-text-secondary py-4">
            {t("mission.uploadDroneMediaDialog.noInspections")}
          </p>
        )}

        {!isLoading && media !== null && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
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
          </DndContext>
        )}
      </div>
    </Modal>
  );
}
