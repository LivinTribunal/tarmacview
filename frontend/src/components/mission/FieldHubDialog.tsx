import { useTranslation } from "react-i18next";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import Modal from "@/components/common/Modal";
import FieldHubPanel from "./FieldHubPanel";

export interface FieldHubDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** poll result owned by the parent - the dialog never opens a second poll. */
  status: FieldLinkStatusResponse | null;
  /** force an on-demand re-check now (the heartbeat button). */
  onRefresh?: () => void | Promise<void>;
  /** a check is in flight - drives the heartbeat spinner. */
  checking?: boolean;
  /** epoch ms of the last completed check. */
  lastChecked?: number | null;
}

/** field hub connection dialog - modal chrome around the shared panel. */
export default function FieldHubDialog({
  isOpen,
  onClose,
  status,
  onRefresh,
  checking = false,
  lastChecked = null,
}: FieldHubDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("mission.fieldHub.title")}>
      <FieldHubPanel
        status={status}
        onRefresh={onRefresh}
        checking={checking}
        lastChecked={lastChecked}
      />
    </Modal>
  );
}
