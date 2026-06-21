import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Upload } from "lucide-react";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import { isAxiosError } from "@/api/client";
import { requestUploadUrl, uploadToPresignedUrl } from "@/api/droneMedia";
import { iterateMeasurement } from "@/api/measurements";
import { useMeasurementProgress } from "@/contexts/MeasurementProgressContext";

interface UploadIterationDialogProps {
  /** the run whose inspection is re-flown - the new run links into its group. */
  measurementId: string;
  onClose: () => void;
}

/** pull a human message off an axios error, falling back to an i18n string. */
function apiErrorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
      return detail.message;
    }
  }
  return fallback;
}

/** single-inspection upload dialog: uploads footage, starts a linked iteration, goes to compare. */
export default function UploadIterationDialog({
  measurementId,
  onClose,
}: UploadIterationDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { track } = useMeasurementProgress();

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleConfirm() {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const keys: string[] = [];
      for (const file of files) {
        const { object_key, upload_url } = await requestUploadUrl(
          file.name,
          file.type || null,
        );
        await uploadToPresignedUrl(upload_url, file);
        keys.push(object_key);
      }
      const run = await iterateMeasurement(measurementId, keys);
      track([run.id]);
      onClose();
      navigate(`/operator-center/measurements/${run.id}/results/compare`);
    } catch (err) {
      setError(apiErrorMessage(err, t("iterationUpload.error")));
      setUploading(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={t("iterationUpload.title")}>
      <div className="flex flex-col gap-4" data-testid="upload-iteration-dialog">
        <p className="text-xs text-tv-text-secondary">{t("iterationUpload.hint")}</p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*"
          disabled={uploading}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-sm text-tv-text-secondary file:mr-3 file:rounded-lg
            file:border-0 file:bg-tv-surface-hover file:px-4 file:py-2 file:text-sm
            file:font-medium file:text-tv-text-primary hover:file:bg-tv-border"
          data-testid="iteration-file-input"
        />

        {files.length > 0 && (
          <ul className="text-xs text-tv-text-secondary" data-testid="iteration-file-list">
            {files.map((file) => (
              <li key={file.name} className="truncate">
                {file.name}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-xs text-tv-error">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            {t("iterationUpload.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={uploading || files.length === 0}
            data-testid="confirm-iteration-upload"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploading ? t("iterationUpload.uploading") : t("iterationUpload.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
