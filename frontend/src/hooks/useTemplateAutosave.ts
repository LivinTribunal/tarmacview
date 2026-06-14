import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { NavigateFunction } from "react-router";
import {
  getInspectionTemplate,
  listInspectionTemplates,
  updateInspectionTemplate,
  deleteInspectionTemplate,
  createInspectionTemplate,
} from "@/api/inspectionTemplates";
import type {
  InspectionTemplateResponse,
  InspectionConfigResponse,
} from "@/types/inspectionTemplate";
import { SCAN_FIELDS, type ScanConfigFields } from "@/types/mission";
import type { AGLResponse, AirportDetailResponse } from "@/types/airport";
import type { InspectionMethod } from "@/types/enums";
import { AGL_AGNOSTIC_METHODS } from "@/utils/methodAglCompatibility";
import { AUTOSAVE_INTERVAL_MS, AUTOSAVE_DEBOUNCE_MS } from "@/constants/ui";
import { DEFAULT_INSPECTION_METHOD } from "@/constants/mission";

interface UseTemplateAutosaveParams {
  id: string | undefined;
  airportDetail: AirportDetailResponse | null;
  navigate: NavigateFunction;
  t: (key: string, opts?: Record<string, unknown>) => string;
  showNotif: (msg: string) => void;
  setShowCreate: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDelete: React.Dispatch<React.SetStateAction<boolean>>;
}

/** template fetch + 32-key config hydration + debounced autosave + crud. */
export default function useTemplateAutosave({
  id,
  airportDetail,
  navigate,
  t,
  showNotif,
  setShowCreate,
  setShowDelete,
}: UseTemplateAutosaveParams) {
  const [template, setTemplate] = useState<InspectionTemplateResponse | null>(null);
  const [allTemplates, setAllTemplates] = useState<InspectionTemplateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // config edit state
  const [editConfig, setEditConfig] = useState<Omit<InspectionConfigResponse, "id"> | null>(null);
  const [editMethod, setEditMethod] = useState<InspectionMethod>(DEFAULT_INSPECTION_METHOD);
  const [selectedAglId, setSelectedAglId] = useState<string>("");
  const [selectedLhaIds, setSelectedLhaIds] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState("");

  // autosave state
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performSaveRef = useRef<(() => Promise<void>) | null>(null);

  // freezes the async lha re-seed once the operator edits the selection
  const userTouchedLhaRef = useRef(false);
  const seededTemplateIdRef = useRef<string | null>(null);

  // tick for relative timestamp display
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const interval = setInterval(() => setTick((n) => n + 1), AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastSaved]);

  // all agls from airport
  const allAgls = useMemo<AGLResponse[]>(() => {
    if (!airportDetail) return [];
    return airportDetail.surfaces.flatMap((s) => s.agls);
  }, [airportDetail]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, []);

  const fetchData = useCallback(async () => {
    /**fetch template and all templates list.*/
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [tpl, allTpl] = await Promise.all([
        getInspectionTemplate(id),
        listInspectionTemplates(
          airportDetail ? { airport_id: airportDetail.id } : undefined,
        ),
      ]);
      setTemplate(tpl);
      setAllTemplates(allTpl.data);
      initializeFromTemplate(tpl);

      // initialize last saved from db timestamp
      if (tpl.updated_at) {
        setLastSaved(new Date(tpl.updated_at));
      } else if (tpl.created_at) {
        setLastSaved(new Date(tpl.created_at));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("coordinator.inspections.loadError"));
    } finally {
      setLoading(false);
    }
  }, [id, airportDetail, t]);

  function initializeFromTemplate(tpl: InspectionTemplateResponse) {
    /**initialize edit state from a template.*/
    // re-enable the lha re-seed only when switching to a different template,
    // not on a same-template refetch (autosave refresh / airport reload)
    if (seededTemplateIdRef.current !== tpl.id) {
      userTouchedLhaRef.current = false;
      seededTemplateIdRef.current = tpl.id;
    }

    const cfg = tpl.default_config;
    setEditConfig(
      cfg
        ? {
            altitude_offset: cfg.altitude_offset,
            angle_offset_above: cfg.angle_offset_above,
            angle_offset_below: cfg.angle_offset_below,
            measurement_speed_override: cfg.measurement_speed_override,
            measurement_density: cfg.measurement_density,
            custom_tolerances: cfg.custom_tolerances,
            hover_duration: cfg.hover_duration,
            horizontal_distance: cfg.horizontal_distance,
            sweep_angle: cfg.sweep_angle,
            angle_source: cfg.angle_source,
            angle_start: cfg.angle_start,
            angle_end: cfg.angle_end,
            lha_ids: cfg.lha_ids,
            lha_selection_rules: cfg.lha_selection_rules,
            capture_mode: cfg.capture_mode,
            recording_setup_duration: cfg.recording_setup_duration,
            buffer_distance: cfg.buffer_distance,
            height_above_lights: cfg.height_above_lights,
            lateral_offset: cfg.lateral_offset,
            distance_from_lha: cfg.distance_from_lha,
            height_above_lha: cfg.height_above_lha,
            camera_gimbal_angle: cfg.camera_gimbal_angle,
            selected_lha_id: cfg.selected_lha_id,
            lha_setting_angle_override_id: cfg.lha_setting_angle_override_id,
            hover_bearing: cfg.hover_bearing,
            hover_bearing_reference: cfg.hover_bearing_reference,
            descent_start_distance: cfg.descent_start_distance,
            descent_glide_slope_override: cfg.descent_glide_slope_override,
            ...(Object.fromEntries(SCAN_FIELDS.map((k) => [k, cfg[k]])) as unknown as ScanConfigFields),
            direction: cfg.direction,
            resolved_direction: cfg.resolved_direction,
            white_balance: cfg.white_balance,
            iso: cfg.iso,
            shutter_speed: cfg.shutter_speed,
            focus_mode: cfg.focus_mode,
            optical_zoom: cfg.optical_zoom,
          }
        : {
            altitude_offset: null,
            angle_offset_above: null,
            angle_offset_below: null,
            measurement_speed_override: null,
            measurement_density: null,
            custom_tolerances: null,
            hover_duration: null,
            horizontal_distance: null,
            sweep_angle: null,
            angle_source: null,
            angle_start: null,
            angle_end: null,
            lha_ids: null,
            lha_selection_rules: null,
            capture_mode: null,
            recording_setup_duration: null,
            buffer_distance: null,
            height_above_lights: null,
            lateral_offset: null,
            distance_from_lha: null,
            height_above_lha: null,
            camera_gimbal_angle: null,
            selected_lha_id: null,
            lha_setting_angle_override_id: null,
            hover_bearing: null,
            hover_bearing_reference: null,
            descent_start_distance: null,
            descent_glide_slope_override: null,
            ...(Object.fromEntries(SCAN_FIELDS.map((k) => [k, null])) as unknown as ScanConfigFields),
            direction: null,
            resolved_direction: null,
            white_balance: null,
            iso: null,
            shutter_speed: null,
            focus_mode: null,
            optical_zoom: null,
          },
    );

    setEditMethod((tpl.methods[0] ?? DEFAULT_INSPECTION_METHOD) as InspectionMethod);
    setEditName(tpl.name);

    const aglId = tpl.target_agl_ids[0] ?? "";
    setSelectedAglId(aglId);

    // initialize lha selection from config or all lhas.
    // AGL-agnostic templates (hover-point-lock, surface-scan) don't pin LHAs -
    // the operator picks the target at mission time - so leave the set empty here.
    const method = (tpl.methods[0] ?? DEFAULT_INSPECTION_METHOD) as InspectionMethod;
    if (cfg?.lha_ids && cfg.lha_ids.length > 0) {
      setSelectedLhaIds(new Set(cfg.lha_ids.map(String)));
    } else if (aglId && !AGL_AGNOSTIC_METHODS.includes(method)) {
      const agl = allAgls.find((a) => a.id === aglId);
      if (agl) setSelectedLhaIds(new Set(agl.lhas.map((l) => l.id)));
    }
  }

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // re-init lha selection when allAgls load after template, until the operator edits it
  useEffect(() => {
    if (userTouchedLhaRef.current) return;
    if (!template || allAgls.length === 0) return;
    const aglId = template.target_agl_ids[0] ?? "";
    if (!aglId) return;

    const agl = allAgls.find((a) => a.id === aglId);
    if (!agl) return;

    const cfg = template.default_config;
    const method = (template.methods[0] ?? DEFAULT_INSPECTION_METHOD) as InspectionMethod;
    if (cfg?.lha_ids && cfg.lha_ids.length > 0) {
      setSelectedLhaIds(new Set(cfg.lha_ids.map(String)));
    } else if (!AGL_AGNOSTIC_METHODS.includes(method)) {
      setSelectedLhaIds(new Set(agl.lhas.map((l) => l.id)));
    }
  }, [allAgls, template]);

  // autosave
  const performSave = useCallback(async () => {
    /**persist current edit state to the backend.*/
    if (!id || !template) return;
    setSaving(true);
    setSaveError(false);
    try {
      const configPayload = editConfig
        ? { ...editConfig, lha_ids: Array.from(selectedLhaIds) }
        : undefined;

      const result = await updateInspectionTemplate(id, {
        name: editName !== template.name ? editName : undefined,
        methods: [editMethod],
        target_agl_ids: selectedAglId ? [selectedAglId] : undefined,
        default_config: configPayload,
      });
      setTemplate(result);
      setLastSaved(new Date());
      setSaveError(false);
    } catch (err) {
      console.error("autosave failed:", err instanceof Error ? err.message : String(err));
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [id, template, editConfig, editMethod, selectedAglId, selectedLhaIds, editName]);

  // keep ref current so scheduled autosave always calls latest performSave
  useEffect(() => {
    performSaveRef.current = performSave;
  }, [performSave]);

  function scheduleAutosave() {
    /**schedule an autosave after debounce delay.*/
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      performSaveRef.current?.();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function handleConfigChange(updates: Partial<Omit<InspectionConfigResponse, "id">>) {
    /**merge config updates atomically and schedule autosave.*/
    setEditConfig((prev) => (prev ? { ...prev, ...updates } : prev));
    scheduleAutosave();
  }

  function handleMethodChange(method: InspectionMethod) {
    /**handle method change and schedule autosave.*/
    setEditMethod(method);
    scheduleAutosave();
  }

  function handleAglChange(aglId: string) {
    /**handle agl change and schedule autosave.*/
    setSelectedAglId(aglId);
    if (aglId) {
      // AGL-agnostic methods pick their target per mission, so leave the
      // template's LHA list empty on AGL change; other methods pre-select all.
      if (AGL_AGNOSTIC_METHODS.includes(editMethod)) {
        setSelectedLhaIds(new Set());
      } else {
        const agl = allAgls.find((a) => a.id === aglId);
        if (agl) setSelectedLhaIds(new Set(agl.lhas.map((l) => l.id)));
      }
    } else {
      setSelectedLhaIds(new Set());
    }
    scheduleAutosave();
  }

  function handleToggleLha(lhaId: string) {
    /**toggle a single lha unit and schedule autosave.*/
    userTouchedLhaRef.current = true;
    setSelectedLhaIds((prev) => {
      const next = new Set(prev);
      if (next.has(lhaId)) next.delete(lhaId);
      else next.add(lhaId);
      return next;
    });
    scheduleAutosave();
  }

  function handleSelectAllLhas() {
    /**select all lha units and schedule autosave.*/
    userTouchedLhaRef.current = true;
    const agl = allAgls.find((a) => a.id === selectedAglId);
    if (agl) setSelectedLhaIds(new Set(agl.lhas.map((l) => l.id)));
    scheduleAutosave();
  }

  function handleDeselectAllLhas() {
    /**deselect all lha units and schedule autosave.*/
    userTouchedLhaRef.current = true;
    setSelectedLhaIds(new Set());
    scheduleAutosave();
  }

  function handleNameChange(name: string) {
    /**handle name edit and schedule autosave.*/
    setEditName(name);
    scheduleAutosave();
  }

  async function handleDuplicate() {
    /**duplicate the current template.*/
    if (!template) return;
    try {
      const result = await createInspectionTemplate({
        name: `${template.name} (Copy)`,
        target_agl_ids: template.target_agl_ids,
        methods: template.methods,
        default_config: editConfig ?? undefined,
      });
      navigate(`/coordinator-center/inspections/${result.id}`);
    } catch (err) {
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.duplicateError"));
    }
  }

  async function handleDelete() {
    /**delete the current template.*/
    if (!id) return;
    try {
      await deleteInspectionTemplate(id);
      setShowDelete(false);
      navigate("/coordinator-center/inspections");
    } catch (err) {
      setShowDelete(false);
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.deleteError"));
    }
  }

  async function handleCreate(data: { name: string; aglId: string; method: InspectionMethod }) {
    /**create a new template.*/
    try {
      const result = await createInspectionTemplate({
        name: data.name,
        target_agl_ids: data.aglId ? [data.aglId] : [],
        methods: [data.method],
      });
      setShowCreate(false);
      navigate(`/coordinator-center/inspections/${result.id}`);
    } catch (err) {
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.createError"));
    }
  }

  return {
    template,
    allTemplates,
    loading,
    error,
    editConfig,
    editMethod,
    selectedAglId,
    selectedLhaIds,
    editName,
    lastSaved,
    saving,
    saveError,
    allAgls,
    fetchData,
    handleConfigChange,
    handleMethodChange,
    handleAglChange,
    handleToggleLha,
    handleSelectAllLhas,
    handleDeselectAllLhas,
    handleNameChange,
    handleDuplicate,
    handleDelete,
    handleCreate,
  };
}
