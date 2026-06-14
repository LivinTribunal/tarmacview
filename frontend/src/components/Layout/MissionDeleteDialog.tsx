import { useTranslation } from "react-i18next";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";

interface MissionDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/** shared delete-mission confirmation modal for both layout modes. */
export default function MissionDeleteDialog({
  isOpen,
  onClose,
  onConfirm,
}: MissionDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("mission.validationExportPage.deleteConfirmTitle")}
    >
      <p className="text-sm text-tv-text-primary mb-6">
        {t("mission.validationExportPage.deleteConfirmMessage")}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {t("common.delete")}
        </Button>
      </div>
    </Modal>
  );
}
