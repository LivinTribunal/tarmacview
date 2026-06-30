import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listDroneProfiles } from "@/api/droneProfiles";
import {
  cancelMission,
  completeMission,
  deleteMission,
  exportMissionFiles,
  getFlightPlan,
  getMission,
  validateMission,
} from "@/api/missions";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";
import useDownloadMissionReport from "@/hooks/useDownloadMissionReport";
import useToast from "@/hooks/useToast";
import { extractApiErrorMessage } from "@/utils/apiError";
import { buildInspectionIndexMap } from "@/utils/inspectionIndex";
import type {
  DjiHeadingMode,
  MissionDetailResponse,
} from "@/types/mission";
import type {
  FlightPlanResponse,
  ValidationViolation,
} from "@/types/flightPlan";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { AltitudeClamp } from "@/types/export";

interface UseMissionValidationOptions {
  id: string | undefined;
  onMissionUpdated: (mission: MissionDetailResponse) => void;
  refreshMissions: () => void;
}

interface ExportOptions {
  include_geozones?: boolean;
  include_runway_buffers?: boolean;
  dji_heading_mode_override?: DjiHeadingMode;
  acknowledge_altitude_clamps?: boolean;
}

export interface UseMissionValidationResult {
  mission: MissionDetailResponse | null;
  flightPlan: FlightPlanResponse | null;
  warnings: ValidationViolation[] | null;
  droneProfiles: DroneProfileResponse[];
  isInitialLoad: boolean;
  error: string | null;
  isValidating: boolean;
  isExporting: boolean;
  notification: string | null;
  inspectionIndexMap: Record<string, number> | undefined;
  clampWarning: AltitudeClamp[] | null;
  dismissClampWarning: () => void;

  fetchData: () => Promise<void>;
  showNotification: (msg: string) => void;
  handleValidate: () => Promise<void>;
  handleExport: (formats: string[], options?: ExportOptions) => Promise<void>;
  handleComplete: () => Promise<void>;
  handleCancel: () => Promise<void>;
  handleDelete: () => Promise<boolean>;

  isDownloadingReport: boolean;
  handleDownloadReport: () => Promise<void>;
}

/** data + lifecycle orchestration for the mission validation/export page. */
export default function useMissionValidation({
  id,
  onMissionUpdated,
  refreshMissions,
}: UseMissionValidationOptions): UseMissionValidationResult {
  const { t } = useTranslation();

  const [mission, setMission] = useState<MissionDetailResponse | null>(null);
  const [flightPlan, setFlightPlan] = useState<FlightPlanResponse | null>(null);
  const [warnings, setWarnings] = useState<ValidationViolation[] | null>(null);
  const [droneProfiles, setDroneProfiles] = useState<DroneProfileResponse[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [clampWarning, setClampWarning] = useState<AltitudeClamp[] | null>(null);
  const { message: notification, show: showNotification } = useToast(
    SLOW_NOTIFICATION_TIMEOUT_MS,
  );

  const dismissClampWarning = useCallback(() => setClampWarning(null), []);

  const inspectionIndexMap = useMemo(() => buildInspectionIndexMap(mission), [mission]);

  const fetchData = useCallback(async () => {
    /** load mission, drone profiles, and flight plan. */
    if (!id) return;
    setError(null);
    try {
      const [missionData, dpData] = await Promise.all([
        getMission(id),
        listDroneProfiles(),
      ]);
      setMission(missionData);
      setDroneProfiles(dpData.data);
      onMissionUpdated(missionData);
      refreshMissions();

      try {
        const fp = await getFlightPlan(id);
        setFlightPlan(fp);
        const violations = fp.validation_result?.violations ?? [];
        setWarnings(violations.length > 0 ? violations : null);
      } catch (err) {
        console.error(
          "failed to load flight plan:",
          err instanceof Error ? err.message : String(err),
        );
        setFlightPlan(null);
        setWarnings(null);
      }
    } catch (err) {
      console.error(
        "failed to load mission:",
        err instanceof Error ? err.message : String(err),
      );
      setError(t("mission.config.loadError"));
    } finally {
      setIsInitialLoad(false);
    }
  }, [id, onMissionUpdated, refreshMissions, t]);

  // reset to first-load mode when navigating to a different mission id
  useEffect(() => {
    setIsInitialLoad(true);
    setMission(null);
    setFlightPlan(null);
    setWarnings(null);
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // re-fetch on tab/window focus
  useEffect(() => {
    function handleFocus() {
      fetchData();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") fetchData();
    }
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchData]);

  const { isDownloadingReport, handleDownloadReport } = useDownloadMissionReport(
    id,
    mission?.name,
    showNotification,
  );

  const handleValidate = useCallback(async () => {
    if (!id) return;
    setIsValidating(true);
    try {
      await validateMission(id);
      await fetchData();
    } catch (err) {
      console.error(
        "validation failed:",
        err instanceof Error ? err.message : String(err),
      );
      showNotification(t("mission.validationExportPage.acceptError"));
    } finally {
      setIsValidating(false);
    }
  }, [id, fetchData, showNotification, t]);

  const handleExport = useCallback(
    async (formats: string[], options: ExportOptions = {}) => {
      if (!id || !mission) return;
      setIsExporting(true);
      try {
        const result = await exportMissionFiles(id, formats, options);

        // backend refused the file pending altitude-clamp acknowledgment.
        // hand the clamp list to ExportPanel and stop - the operator ticks
        // the checkbox, then re-fires with acknowledge_altitude_clamps=true.
        if (result.kind === "clamp_warning") {
          setClampWarning(result.clamps);
          return;
        }
        setClampWarning(null);

        // trigger browser download using the filename from the backend
        // (the backend sanitizer enforces dji flight hub 2 naming rules)
        const url = window.URL.createObjectURL(result.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename ?? `${mission.name}.${formats[0].toLowerCase()}`;

        document.body.appendChild(a);
        try {
          a.click();
        } finally {
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }

        await fetchData();
      } catch (err) {
        console.error(
          "export failed:",
          err instanceof Error ? err.message : String(err),
        );
        // surface the backend's DomainError message when present so the
        // operator sees the real reason (drone-enum fallback, missing
        // waypoints, etc.) instead of the generic "failed to export" toast.
        showNotification(extractApiErrorMessage(err) ?? t("mission.validationExportPage.exportError"));
      } finally {
        setIsExporting(false);
      }
    },
    [id, mission, fetchData, showNotification, t],
  );

  const handleComplete = useCallback(async () => {
    if (!id) return;
    try {
      await completeMission(id);
      await fetchData();
    } catch (err) {
      console.error(
        "complete failed:",
        err instanceof Error ? err.message : String(err),
      );
      showNotification(t("mission.validationExportPage.completeError"));
    }
  }, [id, fetchData, showNotification, t]);

  const handleCancel = useCallback(async () => {
    if (!id) return;
    try {
      await cancelMission(id);
      await fetchData();
    } catch (err) {
      console.error(
        "cancel failed:",
        err instanceof Error ? err.message : String(err),
      );
      showNotification(t("mission.validationExportPage.cancelError"));
    }
  }, [id, fetchData, showNotification, t]);

  const handleDelete = useCallback(async () => {
    if (!id) return false;
    try {
      await deleteMission(id);
      return true;
    } catch (err) {
      console.error(
        "delete failed:",
        err instanceof Error ? err.message : String(err),
      );
      showNotification(t("mission.validationExportPage.deleteError"));
      return false;
    }
  }, [id, showNotification, t]);

  return {
    mission,
    flightPlan,
    warnings,
    droneProfiles,
    isInitialLoad,
    error,
    isValidating,
    isExporting,
    notification,
    inspectionIndexMap,
    clampWarning,
    dismissClampWarning,
    fetchData,
    showNotification,
    handleValidate,
    handleExport,
    handleComplete,
    handleCancel,
    handleDelete,
    isDownloadingReport,
    handleDownloadReport,
  };
}
