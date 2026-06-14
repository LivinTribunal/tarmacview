import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Link2Off, Plus } from "lucide-react";
import {
  coupleSurface,
  createReverseSurface,
  decoupleSurface,
} from "@/api/airports";
import type { SurfaceResponse } from "@/types/airport";
import InfoHint from "@/components/common/InfoHint";

interface PairSurfaceSectionProps {
  airportId: string;
  surface: SurfaceResponse;
  surfaces: SurfaceResponse[];
  onChanged: () => Promise<void> | void;
}

export default function PairSurfaceSection({
  airportId,
  surface,
  surfaces,
  onChanged,
}: PairSurfaceSectionProps) {
  /** pair-link controls: create reverse, couple, decouple. RUNWAY-only. */
  const { t } = useTranslation();
  const [showPairDialog, setShowPairDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = useMemo(
    () =>
      surface.paired_surface_id
        ? surfaces.find((s) => s.id === surface.paired_surface_id) ?? null
        : null,
    [surface.paired_surface_id, surfaces],
  );

  const candidates = useMemo(
    () =>
      surfaces.filter(
        (s) =>
          s.id !== surface.id &&
          s.surface_type === "RUNWAY" &&
          s.airport_id === surface.airport_id &&
          s.paired_surface_id == null,
      ),
    [surface.airport_id, surface.id, surfaces],
  );

  if (surface.surface_type !== "RUNWAY") return null;

  async function handleCreateReverse() {
    /** create the reverse-direction surface and refresh. */
    setBusy(true);
    setError(null);
    try {
      await createReverseSurface(airportId, surface.id, {});
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create reverse failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDecouple() {
    /** break the pair link on this surface and refresh. */
    setBusy(true);
    setError(null);
    try {
      await decoupleSurface(airportId, surface.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "decouple failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
      data-testid="surface-pair-section"
    >
      <div className="flex items-center gap-1">
        <p className="text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide">
          {t("coordinator.detail.surfacePair.title")}
        </p>
        <InfoHint
          text={t("coordinator.detail.surfacePair.help")}
          label={t("coordinator.detail.surfacePair.title")}
          testId="hint-surface-pair"
        />
      </div>

      {pair ? (
        <>
          <p className="text-xs text-tv-text-secondary">
            {t("coordinator.detail.surfacePair.coupledTo", {
              identifier: pair.identifier,
            })}
          </p>
          <button
            type="button"
            onClick={handleDecouple}
            disabled={busy}
            data-testid="surface-pair-decouple"
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            title={t("coordinator.detail.surfacePair.decoupleHelp")}
          >
            <Link2Off className="h-3 w-3" />
            {t("coordinator.detail.surfacePair.decouple")}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleCreateReverse}
            disabled={busy}
            data-testid="surface-pair-create-reverse"
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-accent text-tv-accent hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            title={t("coordinator.detail.surfacePair.createReverseHelp")}
          >
            <Plus className="h-3 w-3" />
            {t("coordinator.detail.surfacePair.createReverse")}
          </button>
          <button
            type="button"
            onClick={() => setShowPairDialog(true)}
            disabled={busy || candidates.length === 0}
            data-testid="surface-pair-couple"
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            title={t("coordinator.detail.surfacePair.pairWithHelp")}
          >
            <Link2 className="h-3 w-3" />
            {t("coordinator.detail.surfacePair.pairWith")}
          </button>
          {candidates.length === 0 && (
            <p className="text-[10px] text-tv-text-muted">
              {t("coordinator.detail.surfacePair.noPairCandidates")}
            </p>
          )}
        </>
      )}

      {error && <p className="text-[10px] text-tv-error">{error}</p>}

      {showPairDialog && (
        <PairSurfaceDialog
          airportId={airportId}
          surface={surface}
          candidates={candidates}
          onClose={() => setShowPairDialog(false)}
          onPaired={async () => {
            setShowPairDialog(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

interface PairSurfaceDialogProps {
  airportId: string;
  surface: SurfaceResponse;
  candidates: SurfaceResponse[];
  onClose: () => void;
  onPaired: () => Promise<void> | void;
}

export function PairSurfaceDialog({
  airportId,
  surface,
  candidates,
  onClose,
  onPaired,
}: PairSurfaceDialogProps) {
  /** modal: pick a target surface and choose primary side, then couple. */
  const { t } = useTranslation();
  const [targetId, setTargetId] = useState<string>(candidates[0]?.id ?? "");
  const [primary, setPrimary] = useState<"self" | "target">("self");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = useMemo(
    () => candidates.find((s) => s.id === targetId) ?? null,
    [candidates, targetId],
  );

  async function handleConfirm() {
    /** couple this surface with the selected target. */
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await coupleSurface(airportId, surface.id, {
        target_surface_id: target.id,
        primary,
      });
      await onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : "couple failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="surface-pair-dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-tv-border bg-tv-bg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-tv-text-primary">
          {t("coordinator.detail.surfacePair.pairWith")}
        </h3>
        <div>
          <label className="block text-xs font-medium mb-1 text-tv-text-secondary">
            {t("coordinator.detail.surfacePair.selectTarget")}
          </label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="surface-pair-dialog-target"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                RWY {c.identifier}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="block text-xs font-medium mb-1 text-tv-text-secondary">
            {t("coordinator.detail.surfacePair.primary")}
          </legend>
          <label className="flex items-center gap-2 text-xs text-tv-text-primary">
            <input
              type="radio"
              name="primary"
              value="self"
              checked={primary === "self"}
              onChange={() => setPrimary("self")}
              data-testid="surface-pair-dialog-primary-self"
            />
            {t("coordinator.detail.surfacePair.primarySelf")} (RWY {surface.identifier})
          </label>
          <label className="flex items-center gap-2 text-xs text-tv-text-primary mt-1">
            <input
              type="radio"
              name="primary"
              value="target"
              checked={primary === "target"}
              onChange={() => setPrimary("target")}
              data-testid="surface-pair-dialog-primary-target"
            />
            {t("coordinator.detail.surfacePair.primaryTarget")}
            {target ? ` (RWY ${target.identifier})` : ""}
          </label>
        </fieldset>
        <p className="text-[11px] text-tv-text-muted">
          {t("coordinator.detail.surfacePair.overwriteWarning")}
        </p>
        {error && <p className="text-[11px] text-tv-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            data-testid="surface-pair-dialog-cancel"
          >
            {t("coordinator.detail.surfacePair.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !target}
            className="rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-accent text-tv-accent hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            data-testid="surface-pair-dialog-confirm"
          >
            {t("coordinator.detail.surfacePair.confirmPair")}
          </button>
        </div>
      </div>
    </div>
  );
}
