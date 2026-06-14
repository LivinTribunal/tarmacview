import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import {
  assignDroneMedia,
  confirmDroneMediaIngest,
  listDroneMedia,
} from "@/api/droneMedia";
import { listMissions } from "@/api/missions";
import type {
  DroneMediaFileResponse,
  DroneMediaListResponse,
} from "@/types/droneMedia";

interface UploadDroneMediaDialogProps {
  isOpen: boolean;
  onClose: () => void;
  airportId: string;
}

interface MissionOption {
  id: string;
  name: string;
}

/** formats an iso date string to dd/mm/yyyy HH:MM. */
function formatCapturedAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

/** filename tail of a media object key. */
function fileName(objectKey: string): string {
  return objectKey.split("/").pop() ?? objectKey;
}

/** dialog grouping returned drone media by mission, with reassign + confirm-ingest. */
export default function UploadDroneMediaDialog({
  isOpen,
  onClose,
  airportId,
}: UploadDroneMediaDialogProps) {
  const { t } = useTranslation();
  const [media, setMedia] = useState<DroneMediaListResponse | null>(null);
  const [missions, setMissions] = useState<MissionOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [confirmingMissionId, setConfirmingMissionId] = useState<string | null>(
    null,
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mediaRes, missionsRes] = await Promise.all([
        listDroneMedia(),
        listMissions({ airport_id: airportId }),
      ]);
      setMedia(mediaRes);
      setMissions(missionsRes.data.map((m) => ({ id: m.id, name: m.name })));
    } catch {
      setError(t("mission.uploadDroneMediaDialog.loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [airportId, t]);

  useEffect(() => {
    if (isOpen) void fetchData();
  }, [isOpen, fetchData]);

  async function handleAssign(fileId: string, missionId: string | null) {
    setBusyFileId(fileId);
    setError(null);
    try {
      await assignDroneMedia(fileId, missionId);
      await fetchData();
    } catch {
      setError(t("mission.uploadDroneMediaDialog.assignError"));
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleConfirm(missionId: string) {
    setConfirmingMissionId(missionId);
    setError(null);
    try {
      await confirmDroneMediaIngest(missionId);
      await fetchData();
    } catch {
      setError(t("mission.uploadDroneMediaDialog.confirmError"));
    } finally {
      setConfirmingMissionId(null);
    }
  }

  function renderFileRow(file: DroneMediaFileResponse) {
    return (
      <div
        key={file.id}
        className="flex items-center gap-2 py-1.5 border-b border-tv-border last:border-b-0"
        data-testid={`media-file-${file.id}`}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-tv-text-primary truncate">
            {fileName(file.object_key)}
          </p>
          <p className="text-xs text-tv-text-secondary">
            {file.captured_at
              ? formatCapturedAt(file.captured_at)
              : t("mission.uploadDroneMediaDialog.noCaptureTime")}
          </p>
        </div>
        <select
          value={file.mission_id ?? ""}
          onChange={(e) => handleAssign(file.id, e.target.value || null)}
          disabled={busyFileId === file.id}
          aria-label={t("mission.uploadDroneMediaDialog.assignTo")}
          className="px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors appearance-none disabled:opacity-50"
          data-testid={`media-assign-${file.id}`}
        >
          <option value="">
            {t("mission.uploadDroneMediaDialog.unassigned")}
          </option>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const isEmpty =
    media !== null &&
    media.missions.length === 0 &&
    media.unassigned.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("mission.uploadDroneMediaDialog.title")}
    >
      <div
        className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto"
        data-testid="upload-drone-media-dialog"
      >
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-tv-accent" />
          </div>
        )}

        {error && <p className="text-xs text-tv-error">{error}</p>}

        {!isLoading && isEmpty && (
          <p className="text-sm text-tv-text-secondary py-4">
            {t("mission.uploadDroneMediaDialog.empty")}
          </p>
        )}

        {!isLoading &&
          media?.missions.map((group) => (
            <section
              key={group.mission_id}
              data-testid={`media-group-${group.mission_id}`}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-tv-text-primary">
                  {group.mission_name}
                  <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-tv-surface-hover text-tv-text-secondary">
                    {t("mission.uploadDroneMediaDialog.fileCount", {
                      count: group.files.length,
                    })}
                  </span>
                </h3>
                <Button
                  variant="primary"
                  disabled={confirmingMissionId === group.mission_id}
                  onClick={() => handleConfirm(group.mission_id)}
                  data-testid={`media-confirm-${group.mission_id}`}
                >
                  {confirmingMissionId === group.mission_id
                    ? t("mission.uploadDroneMediaDialog.confirming")
                    : t("mission.uploadDroneMediaDialog.confirmIngest")}
                </Button>
              </div>
              <div>{group.files.map(renderFileRow)}</div>
            </section>
          ))}

        {!isLoading && media !== null && media.unassigned.length > 0 && (
          <section data-testid="media-group-unassigned">
            <h3 className="text-sm font-semibold text-tv-text-primary mb-1">
              {t("mission.uploadDroneMediaDialog.unassigned")}
              <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-tv-surface-hover text-tv-text-secondary">
                {t("mission.uploadDroneMediaDialog.fileCount", {
                  count: media.unassigned.length,
                })}
              </span>
            </h3>
            <div>{media.unassigned.map(renderFileRow)}</div>
          </section>
        )}
      </div>
    </Modal>
  );
}
