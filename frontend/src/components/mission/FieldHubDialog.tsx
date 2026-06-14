import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, ShieldCheck } from "lucide-react";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import { downloadCaCert } from "@/api/fieldLink";
import { encodeQrMatrix, qrMatrixToPath } from "@/utils/qrcode";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";

const QR_QUIET_ZONE = 4;

export interface FieldHubDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** poll result owned by the parent - the dialog never opens a second poll. */
  status: FieldLinkStatusResponse | null;
}

/** inline-rendered QR of the connect address, no canvas, no npm dependency. */
function ConnectQr({ url }: { url: string }) {
  const { t } = useTranslation();
  const { viewBox, path } = useMemo(() => {
    const matrix = encodeQrMatrix(url);
    const span = matrix.length + QR_QUIET_ZONE * 2;
    return {
      viewBox: `0 0 ${span} ${span}`,
      path: qrMatrixToPath(matrix, QR_QUIET_ZONE),
    };
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={viewBox}
        shapeRendering="crispEdges"
        className="h-40 w-40 rounded-lg bg-white p-2"
        role="img"
        aria-label={url}
        data-testid="field-hub-qr"
      >
        <path d={path} fill="#000000" />
      </svg>
      <span className="text-xs text-tv-text-muted">{t("mission.fieldHub.scanHint")}</span>
    </div>
  );
}

/** field hub connection dialog - connect address, QR, live status, CA cert. */
export default function FieldHubDialog({ isOpen, onClose, status }: FieldHubDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [downloadingCa, setDownloadingCa] = useState(false);
  const [caError, setCaError] = useState(false);

  if (!isOpen) return null;

  const hubOnline = !!status?.hub_online;
  const brokerConnected = !!status?.broker_connected;
  const connectUrl = status?.connect_url ?? null;
  const devices = status?.devices ?? [];

  async function handleCopy() {
    if (!connectUrl) return;
    try {
      await navigator.clipboard?.writeText(connectUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked - the address stays visible for manual copy
    }
  }

  async function handleDownloadCa() {
    setDownloadingCa(true);
    setCaError(false);
    try {
      const { blob, filename } = await downloadCaCert();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setCaError(true);
    } finally {
      setDownloadingCa(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("mission.fieldHub.title")}>
      <div className="flex flex-col gap-4" data-testid="field-hub-dialog">
        {/* hub + broker state */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-tv-text-primary"
            data-testid="field-hub-status"
            data-online={hubOnline}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hubOnline ? "bg-[var(--tv-success)]" : "bg-[var(--tv-error)]"
              }`}
              aria-hidden="true"
            />
            {hubOnline ? t("mission.fieldHub.hubOnline") : t("mission.fieldHub.hubOffline")}
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-tv-text-secondary"
            data-testid="field-hub-broker"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                brokerConnected ? "bg-[var(--tv-success)]" : "bg-[var(--tv-text-secondary)]"
              }`}
              aria-hidden="true"
            />
            {brokerConnected
              ? t("mission.fieldHub.brokerConnected")
              : t("mission.fieldHub.brokerDisconnected")}
          </span>
        </div>

        {/* connect address / QR, gated on the graceful states */}
        {status === null ? (
          <p className="text-sm text-tv-text-muted" data-testid="field-hub-connecting">
            {t("mission.fieldHub.connecting")}
          </p>
        ) : !hubOnline ? (
          <div
            className="rounded-xl border border-tv-border bg-tv-bg p-3"
            data-testid="field-hub-offline"
          >
            <p className="text-sm text-tv-text-secondary">{t("mission.fieldHub.offlineHint")}</p>
          </div>
        ) : !connectUrl ? (
          <div
            className="rounded-xl border border-tv-border bg-tv-bg p-3"
            data-testid="field-hub-no-host"
          >
            <p className="text-sm font-semibold text-tv-text-primary">
              {t("mission.fieldHub.noHost")}
            </p>
            <p className="mt-1 text-xs text-tv-text-muted">{t("mission.fieldHub.noHostHint")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-tv-text-muted">
                {t("mission.fieldHub.connectAddress")}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <code
                  className="flex-1 overflow-x-auto rounded-lg border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary"
                  data-testid="field-hub-connect-url"
                >
                  {connectUrl}
                </code>
                <Button
                  variant="secondary"
                  onClick={handleCopy}
                  className="flex shrink-0 items-center gap-1.5"
                  data-testid="field-hub-copy-btn"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-[var(--tv-success)]" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? t("mission.fieldHub.copied") : t("mission.fieldHub.copy")}
                </Button>
              </div>
              <p className="mt-1 text-xs text-tv-text-muted">{t("mission.fieldHub.connectHint")}</p>
            </div>
            <ConnectQr url={connectUrl} />
          </div>
        )}

        {/* connected devices */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-tv-text-muted">
            {t("mission.fieldHub.devices")}
          </span>
          {devices.length === 0 ? (
            <p className="mt-1 text-sm text-tv-text-muted" data-testid="field-hub-no-devices">
              {t("mission.fieldHub.noDevices")}
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1" data-testid="field-hub-devices">
              {devices.map((device) => (
                <li
                  key={device.sn}
                  className="flex items-center justify-between gap-2 rounded-lg border border-tv-border bg-tv-bg px-3 py-2"
                  data-testid="field-hub-device"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-tv-text-primary">
                      {device.model_name ?? device.sn}
                    </span>
                    <span className="block truncate text-xs text-tv-text-muted">{device.sn}</span>
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 text-xs text-tv-text-secondary"
                    data-online={device.online}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        device.online ? "bg-[var(--tv-success)]" : "bg-[var(--tv-text-secondary)]"
                      }`}
                      aria-hidden="true"
                    />
                    {device.online
                      ? t("mission.fieldHub.deviceOnline")
                      : t("mission.fieldHub.deviceOffline")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* CA certificate */}
        <div className="rounded-xl border border-tv-border bg-tv-bg p-3">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-tv-text-primary">
            <ShieldCheck className="h-4 w-4" />
            {t("mission.fieldHub.caTitle")}
          </span>
          <p className="mt-1 text-xs text-tv-text-muted">{t("mission.fieldHub.caHint")}</p>
          <Button
            variant="secondary"
            onClick={handleDownloadCa}
            disabled={downloadingCa}
            className="mt-2 flex items-center gap-1.5"
            data-testid="field-hub-ca-download"
          >
            <Download className="h-4 w-4" />
            {t("mission.fieldHub.caDownload")}
          </Button>
          {caError && (
            <p className="mt-2 text-xs text-[var(--tv-error)]" data-testid="field-hub-ca-error">
              {t("mission.fieldHub.caError")}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
