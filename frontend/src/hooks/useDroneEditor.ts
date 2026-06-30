import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  getDroneProfile,
  listDroneProfiles,
  createDroneProfile,
  updateDroneProfile,
  deleteDroneProfile,
  uploadDroneModel,
} from "@/api/droneProfiles";
import { listMissions } from "@/api/missions";
import {
  NOTIFICATION_TIMEOUT_MS,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_INTERVAL_MS,
} from "@/constants/ui";
import { MAX_LIST_LIMIT } from "@/constants/pagination";
import { getBundledModel } from "@/config/droneModels";
import { FIELDS, droneToForm, formToPayload } from "@/config/droneFields";
import useToast from "@/hooks/useToast";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { MissionResponse } from "@/types/mission";

interface UseDroneEditorReturn {
  id: string | undefined;
  drone: DroneProfileResponse | null;
  allDrones: DroneProfileResponse[];
  missions: MissionResponse[];
  filteredDrones: DroneProfileResponse[];
  totalDuration: number;
  loading: boolean;
  error: boolean;

  formData: Record<string, string>;
  nameError: string;

  lastSaved: Date | null;
  saving: boolean;
  saveError: boolean;

  notification: string | null;
  showToast: (msg: string) => void;

  showCreateDialog: boolean;
  setShowCreateDialog: React.Dispatch<React.SetStateAction<boolean>>;
  createName: string;
  setCreateName: React.Dispatch<React.SetStateAction<string>>;
  createError: string;
  setCreateError: React.Dispatch<React.SetStateAction<string>>;

  showDeleteDialog: boolean;
  setShowDeleteDialog: React.Dispatch<React.SetStateAction<boolean>>;

  showSelector: boolean;
  droneSearch: string;
  setDroneSearch: React.Dispatch<React.SetStateAction<string>>;
  handleSelectorToggle: () => void;

  isRenamingDrone: boolean;
  renameDroneValue: string;
  setRenameDroneValue: React.Dispatch<React.SetStateAction<string>>;
  startDroneRename: () => void;
  finishDroneRename: () => Promise<void>;

  missionsExpanded: boolean;
  setMissionsExpanded: React.Dispatch<React.SetStateAction<boolean>>;

  handleFieldChange: (key: string, value: string) => void;
  handleSelectDrone: (droneId: string) => void;
  handleDuplicate: () => Promise<void>;
  handleDelete: () => Promise<void>;
  handleCreateNew: (e: React.FormEvent) => Promise<void>;
  handleBackToList: () => void;
  resolveModelUrl: (identifier: string | null) => string | null;
  handleSelectModel: (modelId: string) => Promise<void>;
  handleRemoveModel: () => Promise<void>;
  handleUploadCustomModel: (file: File) => Promise<void>;
}

/** owns drone-editor state, autosave/CRUD/model state machine, and effects. */
export default function useDroneEditor(): UseDroneEditorReturn {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [drone, setDrone] = useState<DroneProfileResponse | null>(null);
  const [allDrones, setAllDrones] = useState<DroneProfileResponse[]>([]);
  const [missions, setMissions] = useState<MissionResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formData, setFormData] = useState<Record<string, string>>({});
  const { message: notification, show: showToast } = useToast(NOTIFICATION_TIMEOUT_MS);

  const [nameError, setNameError] = useState("");

  // autosave state
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestFormRef = useRef<Record<string, string>>({});
  const droneRef = useRef<DroneProfileResponse | null>(null);

  // tick for relative timestamp display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const interval = setInterval(() => setTick((n) => n + 1), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastSaved]);

  // create dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState("");

  // delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // drone selector
  const [showSelector, setShowSelector] = useState(false);
  const [droneSearch, setDroneSearch] = useState("");

  // inline rename
  const [isRenamingDrone, setIsRenamingDrone] = useState(false);
  const [renameDroneValue, setRenameDroneValue] = useState("");

  // collapsible mission list
  const [missionsExpanded, setMissionsExpanded] = useState(true);

  // filtered drones for search
  const filteredDrones = droneSearch
    ? allDrones.filter((d) =>
      d.name.toLowerCase().includes(droneSearch.toLowerCase()),
    )
    : allDrones;

  // sum of mission durations for the selected drone
  const totalDuration = missions.reduce(
    (sum, m) => sum + (m.estimated_duration ?? 0),
    0,
  );

  const performSave = useCallback(
    async (form: Record<string, string>) => {
      /** save the current form data to the backend. */
      if (!id || !droneRef.current) return;
      if (!form.name?.trim()) return;

      setSaving(true);
      setSaveError(false);
      try {
        const updated = await updateDroneProfile(id, formToPayload(form));
        setDrone(updated);
        droneRef.current = updated;
        setLastSaved(new Date());
        setSaveError(false);
      } catch (err) {
        console.error("autosave failed", err);
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    },
    [id],
  );

  /** schedule an autosave after debounce delay. */
  function scheduleAutosave(form: Record<string, string>) {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      performSave(form);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  // cancel pending autosave on page unload
  useEffect(() => {
    function handleBeforeUnload() {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  /** fetch drone profile, all drones list, and missions using this drone. */
  const fetchDrone = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    Promise.all([
      getDroneProfile(id),
      listDroneProfiles({ limit: MAX_LIST_LIMIT }),
      listMissions({ drone_profile_id: id, limit: MAX_LIST_LIMIT }),
    ])
      .then(([droneData, listData, missionsData]) => {
        setDrone(droneData);
        droneRef.current = droneData;
        setAllDrones(listData.data);
        setMissions(missionsData.data);
        const form = droneToForm(droneData);
        setFormData(form);
        latestFormRef.current = form;
        setLastSaved(new Date(droneData.updated_at));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchDrone();
  }, [fetchDrone]);

  /** handle field value change and schedule autosave. */
  function handleFieldChange(key: string, value: string) {
    if (key === "name") setNameError("");
    const next = { ...formData, [key]: value };
    setFormData(next);
    latestFormRef.current = next;

    if (!droneRef.current) return;
    const orig = droneToForm(droneRef.current);
    const dirty = FIELDS.some((f) => next[f.key] !== orig[f.key]);
    if (dirty) {
      scheduleAutosave(next);
    } else {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    }
  }

  /** navigate to a different drone profile. */
  function handleSelectDrone(droneId: string) {
    setShowSelector(false);
    setDroneSearch("");
    if (droneId === id) return;
    // flush pending save before navigating
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
      const orig = droneRef.current ? droneToForm(droneRef.current) : {};
      const dirty = FIELDS.some(
        (f) => latestFormRef.current[f.key] !== orig[f.key],
      );
      if (dirty && latestFormRef.current.name?.trim()) {
        performSave(latestFormRef.current);
      }
    }
    navigate(`/coordinator-center/drones/${droneId}`);
  }

  /** duplicate the current drone profile. */
  async function handleDuplicate() {
    if (!drone) return;
    try {
      const payload = {
        name: `${drone.name} ${t("coordinator.drones.duplicate.suffix")}`,
        manufacturer: drone.manufacturer,
        model: drone.model,
        max_speed: drone.max_speed,
        max_climb_rate: drone.max_climb_rate,
        max_altitude: drone.max_altitude,
        battery_capacity: drone.battery_capacity,
        endurance_minutes: drone.endurance_minutes,
        camera_resolution: drone.camera_resolution,
        camera_frame_rate: drone.camera_frame_rate,
        sensor_fov: drone.sensor_fov,
        weight: drone.weight,
        max_optical_zoom: drone.max_optical_zoom,
        sensor_base_focal_length: drone.sensor_base_focal_length,
        default_optical_zoom: drone.default_optical_zoom,
        model_identifier: drone.model_identifier,
      };
      const created = await createDroneProfile(payload);
      navigate(`/coordinator-center/drones/${created.id}`);
    } catch (err) {
      console.error("duplicate failed", err);
      showToast(t("coordinator.drones.duplicate.error"));
    }
  }

  /** toggle the drone selector dropdown. */
  function handleSelectorToggle() {
    setShowSelector((prev) => {
      if (prev) setDroneSearch("");
      return !prev;
    });
  }

  /** start inline rename of the drone profile. */
  function startDroneRename() {
    if (!drone) return;
    setRenameDroneValue(drone.name);
    setIsRenamingDrone(true);
  }

  /** finish inline rename and persist to backend. */
  async function finishDroneRename() {
    setIsRenamingDrone(false);
    if (!id || !drone || !renameDroneValue.trim() || renameDroneValue.trim() === drone.name) return;
    try {
      const result = await updateDroneProfile(id, { name: renameDroneValue.trim() });
      setDrone(result);
      droneRef.current = result;
      const refreshed = await listDroneProfiles();
      setAllDrones(refreshed.data);
    } catch (err) {
      console.error("rename failed", err);
      showToast(t("coordinator.drones.detail.renameError") ?? "Rename failed");
    }
  }

  /** delete the current drone profile. */
  async function handleDelete() {
    if (!id) return;
    try {
      await deleteDroneProfile(id);
      setShowDeleteDialog(false);
      navigate("/coordinator-center/drones");
    } catch (err) {
      console.error("delete failed", err);
      showToast(t("coordinator.drones.delete.deleteError"));
    }
  }

  /** create a new drone profile from the dialog form. */
  async function handleCreateNew(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError(t("coordinator.drones.create.nameRequired"));
      return;
    }
    try {
      const created = await createDroneProfile({ name: createName.trim() });
      setShowCreateDialog(false);
      setCreateName("");
      setCreateError("");
      navigate(`/coordinator-center/drones/${created.id}`);
    } catch (err) {
      console.error("create failed", err);
      setCreateError(t("coordinator.drones.create.createError"));
    }
  }

  /** navigate back to the drone list. */
  function handleBackToList() {
    navigate("/coordinator-center/drones");
  }

  /** resolve model identifier to a loadable url. */
  function resolveModelUrl(identifier: string | null): string | null {
    if (!identifier) return null;
    const bundled = getBundledModel(identifier);
    if (bundled) return bundled.path;
    return `/static/models/custom/${identifier}`;
  }

  /** select a bundled model and save immediately. */
  async function handleSelectModel(modelId: string) {
    if (!id || !drone) return;
    try {
      const updated = await updateDroneProfile(id, {
        model_identifier: modelId,
      });
      setDrone(updated);
      droneRef.current = updated;
      setLastSaved(new Date());
    } catch (err) {
      console.error("select model failed", err);
      showToast(t("coordinator.drones.detail.saveError"));
    }
  }

  /** remove the model selection. */
  async function handleRemoveModel() {
    if (!id || !drone) return;
    try {
      const updated = await updateDroneProfile(id, {
        model_identifier: null,
      });
      setDrone(updated);
      droneRef.current = updated;
      setLastSaved(new Date());
    } catch (err) {
      console.error("remove model failed", err);
      showToast(t("coordinator.drones.detail.saveError"));
    }
  }

  /** upload a custom model file. */
  async function handleUploadCustomModel(file: File) {
    if (!id) return;
    try {
      const result = await uploadDroneModel(id, file);
      setDrone((prev) =>
        prev ? { ...prev, model_identifier: result.model_identifier } : prev,
      );
      if (droneRef.current) {
        droneRef.current = {
          ...droneRef.current,
          model_identifier: result.model_identifier,
        };
      }
      setLastSaved(new Date());
    } catch (err) {
      console.error("upload model failed", err);
      showToast(t("drone.invalidFileType"));
    }
  }

  return {
    id,
    drone,
    allDrones,
    missions,
    filteredDrones,
    totalDuration,
    loading,
    error,
    formData,
    nameError,
    lastSaved,
    saving,
    saveError,
    notification,
    showToast,
    showCreateDialog,
    setShowCreateDialog,
    createName,
    setCreateName,
    createError,
    setCreateError,
    showDeleteDialog,
    setShowDeleteDialog,
    showSelector,
    droneSearch,
    setDroneSearch,
    handleSelectorToggle,
    isRenamingDrone,
    renameDroneValue,
    setRenameDroneValue,
    startDroneRename,
    finishDroneRename,
    missionsExpanded,
    setMissionsExpanded,
    handleFieldChange,
    handleSelectDrone,
    handleDuplicate,
    handleDelete,
    handleCreateNew,
    handleBackToList,
    resolveModelUrl,
    handleSelectModel,
    handleRemoveModel,
    handleUploadCustomModel,
  };
}
