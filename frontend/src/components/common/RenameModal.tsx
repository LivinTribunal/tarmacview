import { useTranslation } from "react-i18next";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import Input from "@/components/common/Input";

interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  inputId: string;
  inputTestId: string;
  submitTestId?: string;
  submitDisabledWhenEmpty?: boolean;
}

/** shared single-field rename modal for the mission / measurement list pages. */
export default function RenameModal({
  isOpen,
  onClose,
  title,
  value,
  onChange,
  onSubmit,
  placeholder,
  inputId,
  inputTestId,
  submitTestId,
  submitDisabledWhenEmpty = false,
}: RenameModalProps) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <Input
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          data-testid={inputTestId}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={submitDisabledWhenEmpty && !value.trim()}
            data-testid={submitTestId}
          >
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
