import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import FieldHubPanel from "@/components/mission/FieldHubPanel";
import { useAirport } from "@/contexts/AirportContext";
import { useFieldLinkStatus } from "@/hooks/useFieldLinkStatus";
import { deleteWayline, listWaylines } from "@/api/fieldLink";
import {
  assignDroneMedia,
  getDroneMediaViewUrl,
  listDroneMedia,
  moveDroneMedia,
} from "@/api/droneMedia";
import { getMission, listMissions } from "@/api/missions";
import { createMeasurement } from "@/api/measurements";
import type { FieldLinkWayline } from "@/types/fieldLink";
import type { DroneMediaFileResponse } from "@/types/droneMedia";
import type { InspectionResponse, MissionResponse } from "@/types/mission";

/** a flat media row plus the mission name it was matched to, if any. */
interface MediaRow {
  file: DroneMediaFileResponse;
  missionName: string | null;
}

/** per-row state for the inline link-and-process control. */
interface LinkState {
  fileId: string;
  missionId: string;
  inspectionId: string;
  inspections: InspectionResponse[];
  inspectionsLoading: boolean;
  inspectionsError: boolean;
  submitting: boolean;
  error: boolean;
  measurementId: string | null;
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
  const { selectedAirport } = useAirport();

  // shared field-hub poll - drives the left connection panel
  const {
    status: fieldLinkStatus,
    lastChecked,
    checking,
    refresh,
  } = useFieldLinkStatus();

  // cloud missions
  const [waylines, setWaylines] = useState<FieldLinkWayline[]>([]);
  const [waylinesLoading, setWaylinesLoading] = useState(true);
  const [waylinesError, setWaylinesError] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FieldLinkWayline | null>(null);
  const [deleting, setDeleting] = useState(false);

  // drone media
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [mediaLoading, setMediaLoading] = useState(true);
  const [mediaError, setMediaError] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);

  // link-and-process: the operator's missions for the selected airport
  const [missions, setMissions] = useState<MissionResponse[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [missionsError, setMissionsError] = useState(false);

  // the row whose inline control is open, plus its working state
  const [link, setLink] = useState<LinkState | null>(null);

  const loadWaylines = useCallback(async () => {
    setWaylinesLoading(true);
    setWaylinesError(false);
    try {
      const res = await listWaylines();
      setWaylines(res.waylines);
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

  // missions scoped to the selected airport - reloaded whenever it changes
  const loadMissions = useCallback(async () => {
    if (!selectedAirport) {
      setMissions([]);
      return;
    }
    setMissionsLoading(true);
    setMissionsError(false);
    try {
      const res = await listMissions({ airport_id: selectedAirport.id });
      setMissions(res.data);
    } catch {
      setMissionsError(true);
    } finally {
      setMissionsLoading(false);
    }
  }, [selectedAirport]);

  async function handleOpenMedia(fileId: string) {
    setOpenError(false);
    setOpeningId(fileId);
    // open the tab synchronously so the popup blocker doesn't eat it, then
    // point it at the freshly minted presigned url once it resolves
    const win = window.open("", "_blank");
    if (win) win.opener = null;
    try {
      const url = await getDroneMediaViewUrl(fileId);
      if (win) {
        win.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch {
      win?.close();
      setOpenError(true);
    } finally {
      setOpeningId(null);
    }
  }

  useEffect(() => {
    loadWaylines();
    loadMedia();
  }, [loadWaylines, loadMedia]);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

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

  // fetch a mission's inspections; auto-select the lone one when there's just one
  const loadInspections = useCallback(async (fileId: string, missionId: string) => {
    setLink((prev) =>
      prev && prev.fileId === fileId
        ? {
            ...prev,
            missionId,
            inspectionId: "",
            inspections: [],
            inspectionsLoading: true,
            inspectionsError: false,
            error: false,
            measurementId: null,
          }
        : prev,
    );
    try {
      const detail = await getMission(missionId);
      const inspections = [...detail.inspections].sort(
        (a, b) => a.sequence_order - b.sequence_order,
      );
      const auto = inspections.length === 1 ? inspections[0].id : "";
      setLink((prev) =>
        prev && prev.fileId === fileId && prev.missionId === missionId
          ? {
              ...prev,
              inspections,
              inspectionId: auto,
              inspectionsLoading: false,
            }
          : prev,
      );
    } catch {
      setLink((prev) =>
        prev && prev.fileId === fileId && prev.missionId === missionId
          ? { ...prev, inspectionsLoading: false, inspectionsError: true }
          : prev,
      );
    }
  }, []);

  // open the inline control on a row, pre-selecting any already-matched mission
  function openLink(file: DroneMediaFileResponse) {
    const missionId = file.mission_id ?? "";
    setLink({
      fileId: file.id,
      missionId,
      inspectionId: "",
      inspections: [],
      inspectionsLoading: false,
      inspectionsError: false,
      submitting: false,
      error: false,
      measurementId: null,
    });
    if (missionId) {
      loadInspections(file.id, missionId);
    }
  }

  function onMissionChange(fileId: string, missionId: string) {
    if (!missionId) {
      setLink((prev) =>
        prev && prev.fileId === fileId
          ? {
              ...prev,
              missionId: "",
              inspectionId: "",
              inspections: [],
              inspectionsLoading: false,
              inspectionsError: false,
              error: false,
              measurementId: null,
            }
          : prev,
      );
      return;
    }
    loadInspections(fileId, missionId);
  }

  // assign (if needed) -> move to inspection -> start measurement, each awaiting
  // the previous; any failure stops the sequence and surfaces an inline error.
  async function handleLinkConfirm(file: DroneMediaFileResponse) {
    if (!link || link.fileId !== file.id) return;
    const { missionId, inspectionId } = link;
    if (!missionId || !inspectionId) return;
    setLink((prev) =>
      prev && prev.fileId === file.id
        ? { ...prev, submitting: true, error: false, measurementId: null }
        : prev,
    );
    try {
      if (file.mission_id == null || file.mission_id !== missionId) {
        await assignDroneMedia(file.id, missionId);
      }
      await moveDroneMedia(file.id, inspectionId, null);
      const measurement = await createMeasurement(inspectionId);
      setLink((prev) =>
        prev && prev.fileId === file.id
          ? { ...prev, submitting: false, measurementId: measurement.id }
          : prev,
      );
      await loadMedia();
    } catch {
      setLink((prev) =>
        prev && prev.fileId === file.id
          ? { ...prev, submitting: false, error: true }
          : prev,
      );
    }
  }

  /** option label for an inspection - method name plus its sequence order. */
  function inspectionLabel(inspection: InspectionResponse): string {
    return t("fieldOps.linkProcess.inspectionOption", {
      order: inspection.sequence_order,
      method: t(`map.inspectionMethod.${inspection.method}`, inspection.method),
    });
  }

  return (
    <div className="flex h-[calc(100vh-5.25rem)] px-4 pt-2" data-testid="field-ops-page">
      {/* left column - field hub connection */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div
          className="flex-1 flex flex-col overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          <div
            className="bg-tv-surface border border-tv-border rounded-2xl p-4"
            data-testid="field-ops-hub-card"
          >
            <h2 className="text-lg font-semibold text-tv-text-primary mb-3">
              {t("mission.fieldHub.title")}
            </h2>
            <FieldHubPanel
              status={fieldLinkStatus}
              onRefresh={refresh}
              checking={checking}
              lastChecked={lastChecked}
            />
          </div>
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right column - cloud missions + drone media */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-6 pb-2">
          {/* cloud missions section */}
          <section className="bg-tv-surface border border-tv-border rounded-2xl p-4">
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

            <div className="overflow-x-auto">
              {waylinesLoading ? (
                <p className="text-sm text-tv-text-muted" data-testid="field-ops-waylines-loading">
                  {t("common.loading")}
                </p>
              ) : waylinesError ? (
                <div data-testid="field-ops-waylines-error">
                  <p className="text-sm text-tv-error mb-3">
                    {t("fieldOps.cloudMissions.loadError")}
                  </p>
                  <Button variant="secondary" onClick={loadWaylines}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : waylines.length === 0 ? (
                <p className="text-sm text-tv-text-muted" data-testid="field-ops-waylines-empty">
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
                      <th className="px-4 py-2 font-medium text-right">{t("common.actions")}</th>
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
          <section className="bg-tv-surface border border-tv-border rounded-2xl p-4">
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

            {openError && (
              <p className="mb-3 text-sm text-tv-error" data-testid="field-ops-media-open-error">
                {t("fieldOps.droneMedia.openError")}
              </p>
            )}

            <div className="overflow-x-auto">
              {mediaLoading ? (
                <p className="text-sm text-tv-text-muted" data-testid="field-ops-media-loading">
                  {t("common.loading")}
                </p>
              ) : mediaError ? (
                <div data-testid="field-ops-media-error">
                  <p className="text-sm text-tv-error mb-3">{t("fieldOps.droneMedia.loadError")}</p>
                  <Button variant="secondary" onClick={loadMedia}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : media.length === 0 ? (
                <p className="text-sm text-tv-text-muted" data-testid="field-ops-media-empty">
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
                      <th className="px-4 py-2 font-medium text-right">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {media.map(({ file, missionName }) => {
                      const rowLink = link && link.fileId === file.id ? link : null;
                      return (
                        <Fragment key={file.id}>
                          <tr
                            className="border-b border-tv-border last:border-0 text-tv-text-primary"
                            data-testid={`field-ops-media-row-${file.id}`}
                          >
                            <td className="px-4 py-2">
                              <button
                                type="button"
                                onClick={() => handleOpenMedia(file.id)}
                                disabled={openingId === file.id}
                                className="text-tv-accent hover:underline disabled:opacity-50 disabled:cursor-wait text-left"
                                data-testid={`field-ops-media-open-${file.id}`}
                                title={t("fieldOps.droneMedia.open")}
                              >
                                {file.filename ?? file.object_key}
                              </button>
                            </td>
                            <td className="px-4 py-2">
                              {t(`fieldOps.droneMedia.mediaStatus.${file.status}`, file.status)}
                            </td>
                            <td className="px-4 py-2">{formatSize(file.size_bytes)}</td>
                            <td className="px-4 py-2">{missionName ?? "—"}</td>
                            <td className="px-4 py-2">{formatIso(file.captured_at)}</td>
                            <td className="px-4 py-2 text-right">
                              <Button
                                variant="secondary"
                                onClick={() => (rowLink ? setLink(null) : openLink(file))}
                                data-testid={`field-ops-link-toggle-${file.id}`}
                              >
                                {rowLink ? t("common.cancel") : t("fieldOps.linkProcess.open")}
                              </Button>
                            </td>
                          </tr>
                          {rowLink && (
                            <tr
                              className="border-b border-tv-border last:border-0 bg-tv-surface-hover"
                              data-testid={`field-ops-link-panel-${file.id}`}
                            >
                              <td className="px-4 py-3" colSpan={6}>
                                {!selectedAirport ? (
                                  <p
                                    className="text-sm text-tv-text-muted"
                                    data-testid={`field-ops-link-no-airport-${file.id}`}
                                  >
                                    {t("fieldOps.linkProcess.noAirport")}
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    <p className="text-sm text-tv-text-muted">
                                      {t("fieldOps.linkProcess.help")}
                                    </p>

                                    <div className="flex flex-wrap items-end gap-3">
                                      <label className="flex flex-col gap-1 text-sm">
                                        <span className="text-tv-text-muted">
                                          {t("fieldOps.linkProcess.missionLabel")}
                                        </span>
                                        {missionsLoading ? (
                                          <span
                                            className="text-sm text-tv-text-muted"
                                            data-testid={`field-ops-link-missions-loading-${file.id}`}
                                          >
                                            {t("common.loading")}
                                          </span>
                                        ) : missionsError ? (
                                          <span className="flex items-center gap-2">
                                            <span
                                              className="text-sm text-tv-error"
                                              data-testid={`field-ops-link-missions-error-${file.id}`}
                                            >
                                              {t("fieldOps.linkProcess.missionsError")}
                                            </span>
                                            <Button variant="secondary" onClick={loadMissions}>
                                              {t("common.retry")}
                                            </Button>
                                          </span>
                                        ) : (
                                          <select
                                            className="h-10 min-w-56 rounded-full border border-tv-border bg-tv-surface px-4 text-sm text-tv-text-primary"
                                            value={rowLink.missionId}
                                            onChange={(e) => onMissionChange(file.id, e.target.value)}
                                            data-testid={`field-ops-link-mission-${file.id}`}
                                          >
                                            <option value="">
                                              {t("fieldOps.linkProcess.missionPlaceholder")}
                                            </option>
                                            {missions.map((m) => (
                                              <option key={m.id} value={m.id}>
                                                {m.name}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </label>

                                      <label className="flex flex-col gap-1 text-sm">
                                        <span className="text-tv-text-muted">
                                          {t("fieldOps.linkProcess.inspectionLabel")}
                                        </span>
                                        {rowLink.inspectionsLoading ? (
                                          <span
                                            className="text-sm text-tv-text-muted"
                                            data-testid={`field-ops-link-inspections-loading-${file.id}`}
                                          >
                                            {t("common.loading")}
                                          </span>
                                        ) : rowLink.inspectionsError ? (
                                          <span className="flex items-center gap-2">
                                            <span
                                              className="text-sm text-tv-error"
                                              data-testid={`field-ops-link-inspections-error-${file.id}`}
                                            >
                                              {t("fieldOps.linkProcess.inspectionsError")}
                                            </span>
                                            <Button
                                              variant="secondary"
                                              onClick={() =>
                                                loadInspections(file.id, rowLink.missionId)
                                              }
                                            >
                                              {t("common.retry")}
                                            </Button>
                                          </span>
                                        ) : (
                                          <select
                                            className="h-10 min-w-56 rounded-full border border-tv-border bg-tv-surface px-4 text-sm text-tv-text-primary disabled:opacity-50"
                                            value={rowLink.inspectionId}
                                            disabled={!rowLink.missionId}
                                            onChange={(e) =>
                                              setLink((prev) =>
                                                prev && prev.fileId === file.id
                                                  ? {
                                                      ...prev,
                                                      inspectionId: e.target.value,
                                                      error: false,
                                                    }
                                                  : prev,
                                              )
                                            }
                                            data-testid={`field-ops-link-inspection-${file.id}`}
                                          >
                                            <option value="">
                                              {t("fieldOps.linkProcess.inspectionPlaceholder")}
                                            </option>
                                            {rowLink.inspections.map((ins) => (
                                              <option key={ins.id} value={ins.id}>
                                                {inspectionLabel(ins)}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                      </label>

                                      <Button
                                        variant="primary"
                                        onClick={() => handleLinkConfirm(file)}
                                        disabled={
                                          rowLink.submitting ||
                                          !rowLink.missionId ||
                                          !rowLink.inspectionId
                                        }
                                        data-testid={`field-ops-link-confirm-${file.id}`}
                                      >
                                        {rowLink.submitting
                                          ? t("fieldOps.linkProcess.starting")
                                          : t("fieldOps.linkProcess.confirm")}
                                      </Button>
                                    </div>

                                    {rowLink.error && (
                                      <p
                                        className="text-sm text-tv-error"
                                        data-testid={`field-ops-link-error-${file.id}`}
                                      >
                                        {t("fieldOps.linkProcess.error")}
                                      </p>
                                    )}

                                    {rowLink.measurementId && (
                                      <p
                                        className="text-sm text-tv-text-primary"
                                        data-testid={`field-ops-link-success-${file.id}`}
                                      >
                                        {t("fieldOps.linkProcess.success")}{" "}
                                        <Link
                                          to={`/operator-center/measurements/${rowLink.measurementId}/results`}
                                          className="text-tv-accent hover:underline"
                                          data-testid={`field-ops-link-results-${file.id}`}
                                        >
                                          {t("fieldOps.linkProcess.viewResults")}
                                        </Link>
                                      </p>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>

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
