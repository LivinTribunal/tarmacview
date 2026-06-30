import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MissionStatus } from "@/types/enums";
import type { DjiHeadingMode, MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { AltitudeClamp } from "@/types/export";
import {
  GEOZONE_ADVISORY_FORMATS,
  GEOZONE_ENFORCED_FORMATS,
  canIncludeGeozones,
} from "@/constants/exportCapabilities";
import { isExportEligible } from "@/constants/mission";
import { useFieldLinkStatus } from "@/hooks/useFieldLinkStatus";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import ExportFormatSection from "./ExportFormatSection";
import MissionReportSection from "./MissionReportSection";
import MissionLifecycleSection from "./MissionLifecycleSection";
import SendToDroneSection from "./SendToDroneSection";
import FieldHubDialog from "./FieldHubDialog";
import AltitudeClampWarning from "./AltitudeClampWarning";

const DJI_WPMZ_FORMATS = new Set(["KMZ", "WPML"]);

const EMPTY_DRONE_PROFILES: DroneProfileResponse[] = [];

export interface ExportPanelProps {
  mission: MissionDetailResponse;
  droneProfiles?: DroneProfileResponse[];
  onExport: (
    formats: string[],
    options?: {
      include_geozones?: boolean;
      include_runway_buffers?: boolean;
      dji_heading_mode_override?: DjiHeadingMode;
      acknowledge_altitude_clamps?: boolean;
    },
  ) => void;
  onComplete: () => void;
  onCancel: () => void;
  onDelete: () => void;
  isExporting: boolean;
  statsSlot?: ReactNode;
  onDownloadReport?: () => void;
  isDownloadingReport?: boolean;
  hasFlightPlan?: boolean;
  clampWarning?: AltitudeClamp[] | null;
  onDismissClampWarning?: () => void;
  /** refetch after a dispatch - the mission may transition VALIDATED -> EXPORTED. */
  onDispatched?: () => void;
  /** open the mission's measurements list (results entry point). */
  onViewResults?: () => void;
}

function isTerminal(status: MissionStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export default function ExportPanel({
  mission,
  droneProfiles = EMPTY_DRONE_PROFILES,
  onExport,
  onComplete,
  onCancel,
  onDelete,
  isExporting,
  statsSlot,
  onDownloadReport,
  isDownloadingReport = false,
  hasFlightPlan = false,
  clampWarning = null,
  onDismissClampWarning,
  onDispatched,
  onViewResults,
}: ExportPanelProps) {
  /** flight-plan export, report download, and mission lifecycle controls. */
  const { t } = useTranslation();
  // one poll shared by the status chip, the send-to-drone gate, and the dialog
  const {
    status: fieldLinkStatus,
    refresh: refreshFieldLink,
    checking: fieldLinkChecking,
    lastChecked: fieldLinkChecked,
  } = useFieldLinkStatus();
  const [exportCollapsed, setExportCollapsed] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<Set<string>>(
    new Set(["KMZ"]),
  );
  const [includeGeozones, setIncludeGeozones] = useState(false);
  const [includeRunwayBuffers, setIncludeRunwayBuffers] = useState(false);
  const [headingMode, setHeadingMode] = useState<DjiHeadingMode>(
    mission.dji_heading_mode ?? "smoothTransition",
  );
  const [acknowledgeClamps, setAcknowledgeClamps] = useState(false);
  const [fieldHubOpen, setFieldHubOpen] = useState(false);

  // clear the operator's acknowledgment whenever the warning is dismissed or
  // a fresh clamp set arrives, so the next download requires a deliberate tick.
  useEffect(() => {
    setAcknowledgeClamps(false);
  }, [clampWarning]);
  const [confirmModal, setConfirmModal] = useState<
    "complete" | "cancel" | "delete" | "wpml-fallback" | null
  >(null);
  // captured export args for the wpml-fallback flow - the modal's Continue
  // button replays them so we don't have to recompute the option payload.
  const [pendingExport, setPendingExport] = useState<{
    formats: string[];
    options: Parameters<typeof onExport>[1];
  } | null>(null);

  // resync the picker when the mission's persisted preference changes -
  // happens after a successful export side-effects the column.
  useEffect(() => {
    setHeadingMode(mission.dji_heading_mode ?? "smoothTransition");
  }, [mission.dji_heading_mode]);

  const status = mission.status;
  const exportEnabled = isExportEligible(status);
  const terminal = isTerminal(status);

  // lifecycle button gating:
  // - complete only once MEASURED
  // - cancel from any non-terminal status (confirm-warning before cancelling)
  // - delete anytime (confirm-warning before deleting)
  const canComplete = status === "MEASURED";
  const canCancelMission = !terminal;
  const canDelete = true;

  const formatList = useMemo(() => Array.from(selectedFormats), [selectedFormats]);
  const geozoneCheck = useMemo(
    () =>
      canIncludeGeozones(formatList, {
        supports_geozone_upload: mission.supports_geozone_upload ?? null,
      }),
    [formatList, mission.supports_geozone_upload],
  );

  const enforcedSelected = formatList.filter((fmt) => GEOZONE_ENFORCED_FORMATS.has(fmt));
  const advisorySelected = formatList.filter((fmt) => GEOZONE_ADVISORY_FORMATS.has(fmt));
  const showAdvisoryNote = includeGeozones && advisorySelected.length > 0;
  const mavlinkSelected = selectedFormats.has("MAVLINK");

  // dji heading mode picker is shown only when (a) a DJI WPMZ format (KMZ/WPML)
  // is selected and (b) the resolved drone profile is from DJI. the mode is
  // ignored by every other generator, and a non-DJI mission has no use for it.
  const activeDroneProfile = useMemo(
    () => droneProfiles.find((dp) => dp.id === mission.drone_profile_id) ?? null,
    [droneProfiles, mission.drone_profile_id],
  );
  const isDjiMission = activeDroneProfile?.manufacturer?.toLowerCase() === "dji";
  const djiFormatSelected = formatList.some((fmt) => DJI_WPMZ_FORMATS.has(fmt));
  const showHeadingModePicker =
    !terminal && exportEnabled && isDjiMission && djiFormatSelected;

  function selectFormat(fmt: string) {
    setSelectedFormats(new Set([fmt]));
  }

  function handleToggleGeozones() {
    setIncludeGeozones((prev) => {
      const next = !prev;
      if (!next) {
        setIncludeRunwayBuffers(false);
      }
      return next;
    });
  }

  function handleDownload() {
    if (selectedFormats.size === 0) return;
    const formats = Array.from(selectedFormats);
    const options: Parameters<typeof onExport>[1] = {
      include_geozones: includeGeozones && geozoneCheck.enabled,
      include_runway_buffers:
        includeGeozones && geozoneCheck.enabled && includeRunwayBuffers && mavlinkSelected,
      // only forward the heading mode when the picker is visible. when
      // hidden (non-DJI mission, or no DJI WPMZ format selected), let the
      // backend fall back to mission.dji_heading_mode unchanged.
      ...(showHeadingModePicker ? { dji_heading_mode_override: headingMode } : {}),
      ...(clampWarning && acknowledgeClamps ? { acknowledge_altitude_clamps: true } : {}),
    };

    // intercept dji kmz/wpml exports for drones that aren't in the wpml
    // enum table - the backend falls back to the m4t enum so the operator
    // should know what the file is tagged as before the download starts.
    const needsFallbackWarning =
      djiFormatSelected && !(activeDroneProfile?.supports_dji_wpml ?? false);
    if (needsFallbackWarning) {
      setPendingExport({ formats, options });
      setConfirmModal("wpml-fallback");
      return;
    }
    onExport(formats, options);
  }

  const clampGateOpen = !clampWarning || acknowledgeClamps;

  function handleConfirm() {
    if (confirmModal === "complete") onComplete();
    if (confirmModal === "cancel") onCancel();
    if (confirmModal === "delete") onDelete();
    if (confirmModal === "wpml-fallback" && pendingExport) {
      onExport(pendingExport.formats, pendingExport.options);
      setPendingExport(null);
    }
    setConfirmModal(null);
  }

  function handleCloseConfirm() {
    setConfirmModal(null);
    setPendingExport(null);
  }

  // wpml-fallback copy branches on drone presence + manufacturer. the
  // backend uses the m4t enum (99/1/89/0) as the fallback for everyone -
  // the message just tells the operator what they're actually getting.
  const fallbackModalBody = (() => {
    if (!activeDroneProfile) {
      return t("mission.validationExportPage.wpmlFallback.bodyNoDrone");
    }
    const droneName =
      activeDroneProfile.name ||
      activeDroneProfile.model ||
      t("mission.validationExportPage.wpmlFallback.unknownDrone");
    if (activeDroneProfile.is_dji) {
      return t("mission.validationExportPage.wpmlFallback.bodyUnmappedDji", {
        drone: droneName,
      });
    }
    return t("mission.validationExportPage.wpmlFallback.bodyNonDji", {
      drone: droneName,
    });
  })();

  const confirmConfig = {
    complete: {
      title: t("mission.validationExportPage.completeConfirmTitle"),
      message: t("mission.validationExportPage.completeConfirmMessage"),
      color: "bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover",
      confirmLabel: t("mission.validationExportPage.confirm"),
    },
    cancel: {
      title: t("mission.validationExportPage.cancelConfirmTitle"),
      message: t("mission.validationExportPage.cancelConfirmMessage"),
      color: "bg-tv-warning text-white hover:opacity-90",
      confirmLabel: t("mission.validationExportPage.confirm"),
    },
    delete: {
      title: t("mission.validationExportPage.deleteConfirmTitle"),
      message: t("mission.validationExportPage.deleteConfirmMessage"),
      color: "bg-tv-error text-white hover:opacity-90",
      confirmLabel: t("mission.validationExportPage.confirm"),
    },
    "wpml-fallback": {
      title: t("mission.validationExportPage.wpmlFallback.title"),
      message: fallbackModalBody,
      color: "bg-tv-warning text-white hover:opacity-90",
      confirmLabel: t("mission.validationExportPage.wpmlFallback.continue"),
    },
  };

  return (
    <div className="flex flex-col gap-4" data-testid="export-panel">
      <ExportFormatSection
        exportCollapsed={exportCollapsed}
        onToggleCollapsed={() => setExportCollapsed(!exportCollapsed)}
        exportEnabled={exportEnabled}
        terminal={terminal}
        selectedFormats={selectedFormats}
        onSelectFormat={selectFormat}
        geozoneCheck={geozoneCheck}
        includeGeozones={includeGeozones}
        onToggleGeozones={handleToggleGeozones}
        includeRunwayBuffers={includeRunwayBuffers}
        onToggleRunwayBuffers={() => setIncludeRunwayBuffers((p) => !p)}
        mavlinkSelected={mavlinkSelected}
        enforcedSelected={enforcedSelected}
        advisorySelected={advisorySelected}
        showAdvisoryNote={showAdvisoryNote}
        showHeadingModePicker={showHeadingModePicker}
        headingMode={headingMode}
        onHeadingModeChange={setHeadingMode}
        flightPlanScope={mission.flight_plan_scope}
        onDownload={handleDownload}
        isExporting={isExporting}
        downloadDisabled={!clampGateOpen}
        warningSlot={
          clampWarning ? (
            <AltitudeClampWarning
              clamps={clampWarning}
              acknowledged={acknowledgeClamps}
              onAcknowledgedChange={setAcknowledgeClamps}
              onDismiss={onDismissClampWarning}
            />
          ) : null
        }
      />

      <SendToDroneSection
        missionId={mission.id}
        missionStatus={status}
        linkStatus={fieldLinkStatus}
        onDispatched={onDispatched}
        onOpenFieldHub={() => setFieldHubOpen(true)}
      />

      <FieldHubDialog
        isOpen={fieldHubOpen}
        onClose={() => setFieldHubOpen(false)}
        status={fieldLinkStatus}
        onRefresh={refreshFieldLink}
        checking={fieldLinkChecking}
        lastChecked={fieldLinkChecked}
      />

      <MissionReportSection
        onDownloadReport={onDownloadReport}
        isDownloadingReport={isDownloadingReport}
        hasFlightPlan={hasFlightPlan}
      />

      {onViewResults && (
        <Button
          variant="secondary"
          onClick={onViewResults}
          className="w-full"
          data-testid="view-results-btn"
        >
          {t("measurementsList.viewResults")}
        </Button>
      )}

      {statsSlot}

      <MissionLifecycleSection
        canComplete={canComplete}
        canCancelMission={canCancelMission}
        canDelete={canDelete}
        onRequestComplete={() => setConfirmModal("complete")}
        onRequestCancel={() => setConfirmModal("cancel")}
        onRequestDelete={() => setConfirmModal("delete")}
      />

      {/* confirmation modal */}
      {confirmModal && (
        <Modal
          isOpen={true}
          onClose={handleCloseConfirm}
          title={confirmConfig[confirmModal].title}
        >
          <p className="text-sm text-tv-text-secondary mb-4">
            {confirmConfig[confirmModal].message}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleCloseConfirm}>
              {t("common.cancel")}
            </Button>
            <button
              type="button"
              onClick={handleConfirm}
              className={`px-4 py-2.5 text-sm font-semibold rounded-full transition-colors ${confirmConfig[confirmModal].color}`}
              data-testid="confirm-action-btn"
            >
              {confirmConfig[confirmModal].confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
