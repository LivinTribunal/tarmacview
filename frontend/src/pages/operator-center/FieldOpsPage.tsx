import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import {
  deleteWayline,
  getFieldLinkStatus,
  listWaylines,
} from "@/api/fieldLink";
import { listDroneMedia } from "@/api/droneMedia";
import type { FieldLinkWayline } from "@/types/fieldLink";
import type { DroneMediaFileResponse } from "@/types/droneMedia";

/** a flat media row plus the mission name it was matched to, if any. */
interface MediaRow {
  file: DroneMediaFileResponse;
  missionName: string | null;
}

/** human-readable byte size, em-dash for null. */
function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/** format an epoch-ms timestamp for display, em-dash for null/zero. */
function formatEpochMs(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

/** format an iso timestamp for display, em-dash for null. */
function formatIso(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** operator field-ops page: cloud wayline missions + transferred drone media. */
export default function FieldOpsPage() {
  const { t } = useTranslation();

  // cloud missions
  const [waylines, setWaylines] = useState<FieldLinkWayline[]>([]);
  const [waylinesLoading, setWaylinesLoading] = useState(true);
  const [waylinesError, setWaylinesError] = useState(false);
  const [hubOnline, setHubOnline] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<FieldLinkWayline | null>(null);
  const [deleting, setDeleting] = useState(false);

  // drone media
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState(false);

  const loadWaylines = useCallback(async () => {
    setWaylinesLoading(true);
    setWaylinesError(false);
    try {
      const [res, status] = await Promise.all([
        listWaylines(),
        getFieldLinkStatus(),
      ]);
      setWaylines(res.waylines);
      setHubOnline(status.hub_online);
    } catch {
      setWaylinesError(true);
    } finally {
      setWaylinesLoading(false);
    }
  }, []);

  const loadMedia = useCallback(async () => {
    setMediaLoading(true);
    setMediaError(false);
    try {
      const res = await listDroneMedia();
      const rows: MediaRow[] = [];
      for (const group of res.missions) {
        for (const file of group.files) {
          rows.push({ file, missionName: group.mission_name });
        }
      }
      for (const file of res.unassigned) {
        rows.push({ file, missionName: null });
      }
      setMedia(rows);
    } catch {
      setMediaError(true);
    } finally {
      setMediaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWaylines();
    loadMedia();
  }, [loadWaylines, loadMedia]);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWayline(deleteTarget.id);
      setDeleteTarget(null);
      await loadWaylines();
    } catch {
      setWaylinesError(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-6 space-y-8" data-testid="field-ops-page">
      {/* cloud missions section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-tv-text-primary">
            {t("fieldOps.cloudMissions.title")}
          </h2>
          <Button
            variant="secondary"
            onClick={loadWaylines}
            data-testid="field-ops-refresh-waylines"
          >
            {t("fieldOps.refresh")}
          </Button>
        </div>

        {!hubOnline && !waylinesLoading && (
          <p
            className="mb-3 text-sm text-tv-text-muted"
            data-testid="field-ops-hub-offline"
          >
            {t("fieldOps.hubOffline")}
          </p>
        )}

        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          {waylinesLoading ? (
            <p className="p-4 text-sm text-tv-text-muted" data-testid="field-ops-waylines-loading">
              {t("common.loading")}
            </p>
          ) : waylinesError ? (
            <div className="p-4" data-testid="field-ops-waylines-error">
              <p className="text-sm text-tv-error mb-3">{t("fieldOps.cloudMissions.loadError")}</p>
              <Button variant="secondary" onClick={loadWaylines}>
                {t("common.retry")}
              </Button>
            </div>
          ) : waylines.length === 0 ? (
            <p className="p-4 text-sm text-tv-text-muted" data-testid="field-ops-waylines-empty">
              {t("fieldOps.cloudMissions.empty")}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="field-ops-waylines-table">
              <thead>
                <tr className="text-left text-tv-text-muted border-b border-tv-border">
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.cloudMissions.columns.name")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.cloudMissions.columns.drone")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.cloudMissions.columns.updated")}
                  </th>
                  <th className="px-4 py-2 font-medium text-right">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {waylines.map((w) => (
                  <tr
                    key={w.id}
                    className="border-b border-tv-border last:border-0 text-tv-text-primary"
                    data-testid={`field-ops-wayline-row-${w.id}`}
                  >
                    <td className="px-4 py-2">{w.name}</td>
                    <td className="px-4 py-2">{w.drone_model_key ?? "—"}</td>
                    <td className="px-4 py-2">{formatEpochMs(w.update_time)}</td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="danger"
                        onClick={() => setDeleteTarget(w)}
                        data-testid={`field-ops-wayline-delete-${w.id}`}
                      >
                        {t("common.delete")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* drone media section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-tv-text-primary">
            {t("fieldOps.droneMedia.title")}
          </h2>
          <Button
            variant="secondary"
            onClick={loadMedia}
            data-testid="field-ops-refresh-media"
          >
            {t("fieldOps.refresh")}
          </Button>
        </div>

        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          {mediaLoading ? (
            <p className="p-4 text-sm text-tv-text-muted" data-testid="field-ops-media-loading">
              {t("common.loading")}
            </p>
          ) : mediaError ? (
            <div className="p-4" data-testid="field-ops-media-error">
              <p className="text-sm text-tv-error mb-3">{t("fieldOps.droneMedia.loadError")}</p>
              <Button variant="secondary" onClick={loadMedia}>
                {t("common.retry")}
              </Button>
            </div>
          ) : media.length === 0 ? (
            <p className="p-4 text-sm text-tv-text-muted" data-testid="field-ops-media-empty">
              {t("fieldOps.droneMedia.empty")}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="field-ops-media-table">
              <thead>
                <tr className="text-left text-tv-text-muted border-b border-tv-border">
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.droneMedia.columns.file")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.droneMedia.columns.status")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.droneMedia.columns.size")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.droneMedia.columns.mission")}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t("fieldOps.droneMedia.columns.captured")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {media.map(({ file, missionName }) => (
                  <tr
                    key={file.id}
                    className="border-b border-tv-border last:border-0 text-tv-text-primary"
                    data-testid={`field-ops-media-row-${file.id}`}
                  >
                    <td className="px-4 py-2">{file.filename ?? file.object_key}</td>
                    <td className="px-4 py-2">
                      {t(`fieldOps.droneMedia.mediaStatus.${file.status}`, file.status)}
                    </td>
                    <td className="px-4 py-2">{formatSize(file.size_bytes)}</td>
                    <td className="px-4 py-2">{missionName ?? "—"}</td>
                    <td className="px-4 py-2">{formatIso(file.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("common.delete")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("fieldOps.cloudMissions.deleteConfirm", {
            name: deleteTarget?.name ?? "",
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={deleting}
            data-testid="field-ops-confirm-delete"
          >
            {t("common.delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
