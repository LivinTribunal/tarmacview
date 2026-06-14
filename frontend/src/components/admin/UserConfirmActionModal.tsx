import { useTranslation } from "react-i18next";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import type { UserAdminResponse } from "@/types/admin";

type ConfirmActionType = "deactivate" | "activate" | "delete";

interface UserConfirmActionModalProps {
  action: { type: ConfirmActionType; user: UserAdminResponse } | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** confirm dialog for deactivate / activate / delete account actions. */
export default function UserConfirmActionModal({
  action,
  onCancel,
  onConfirm,
}: UserConfirmActionModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={!!action}
      onClose={onCancel}
      title={
        action?.type === "deactivate"
          ? t("admin.deactivateUser")
          : action?.type === "activate"
            ? t("admin.activateUser")
            : t("admin.deleteUser")
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-tv-text-secondary">
          {action?.type === "delete"
            ? t("admin.deleteUserConfirm", { name: action?.user.name })
            : t("admin.deactivateConfirm", { name: action?.user.name })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t("common.yes")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
