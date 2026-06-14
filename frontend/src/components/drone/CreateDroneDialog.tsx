import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import DroneModelSelector from "@/components/drone/DroneModelSelector";
import {
  buildCreatePayload,
  type CreateForm,
} from "@/components/drone/buildCreatePayload";
import { createDroneProfile } from "@/api/droneProfiles";
import type { DroneProfileResponse } from "@/types/droneProfile";

interface CreateDroneDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (drone: DroneProfileResponse) => void;
}

const EMPTY_FORM: CreateForm = {
  name: "",
  max_speed: "",
  max_altitude: "",
  endurance_minutes: "",
  camera_frame_rate: "",
};

/** create-drone modal used by the coordinator drone list. */
export default function CreateDroneDialog({
  isOpen,
  onClose,
  onCreated,
}: CreateDroneDialogProps) {
  const { t } = useTranslation();

  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [modelId, setModelId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  function reset() {
    setForm(EMPTY_FORM);
    setCreateError("");
    setModelId(null);
  }

  function handleClose() {
    onClose();
    reset();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setCreateError(t("coordinator.drones.create.nameRequired"));
      return;
    }
    try {
      const created = await createDroneProfile(buildCreatePayload(form, modelId));
      onClose();
      reset();
      onCreated(created);
    } catch {
      setCreateError(t("coordinator.drones.create.createError"));
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("coordinator.drones.create.title")}
    >
      <form onSubmit={handleCreate}>
        <div className="flex flex-col gap-3">
          <Input
            id="create-drone-name"
            label={t("coordinator.drones.fields.name")}
            value={form.name}
            onChange={(e) =>
              setForm((f) => ({ ...f, name: e.target.value }))
            }
            placeholder={t("coordinator.drones.create.namePlaceholder")}
            required
            data-testid="create-drone-name"
          />
          <Input
            id="create-drone-speed"
            label={`${t("coordinator.drones.fields.maxSpeed")} (${t("coordinator.drones.units.ms")})`}
            type="number"
            step="any"
            value={form.max_speed}
            onChange={(e) =>
              setForm((f) => ({ ...f, max_speed: e.target.value }))
            }
          />
          <Input
            id="create-drone-altitude"
            label={`${t("coordinator.drones.fields.maxAltitude")} (${t("coordinator.drones.units.m")})`}
            type="number"
            step="any"
            value={form.max_altitude}
            onChange={(e) =>
              setForm((f) => ({ ...f, max_altitude: e.target.value }))
            }
          />
          <Input
            id="create-drone-endurance"
            label={`${t("coordinator.drones.fields.endurance")} (${t("coordinator.drones.units.min")})`}
            type="number"
            step="any"
            value={form.endurance_minutes}
            onChange={(e) =>
              setForm((f) => ({ ...f, endurance_minutes: e.target.value }))
            }
          />
          <Input
            id="create-drone-framerate"
            label={`${t("coordinator.drones.fields.cameraFrameRate")} (${t("coordinator.drones.units.fps")})`}
            type="number"
            step="any"
            value={form.camera_frame_rate}
            onChange={(e) =>
              setForm((f) => ({ ...f, camera_frame_rate: e.target.value }))
            }
          />
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-tv-text-secondary uppercase tracking-wider mb-2">
            {t("drone.selectModel")}
          </p>
          <DroneModelSelector
            selectedModelId={modelId}
            onSelectModel={setModelId}
            onRemoveModel={() => setModelId(null)}
            showUpload={false}
          />
        </div>

        {createError && (
          <p className="mt-3 text-sm text-tv-error">{createError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!form.name.trim()}>
            {t("coordinator.drones.create.add")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
