import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldLinkStatus } from "@/api/fieldLink";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import { FIELD_LINK_POLL_INTERVAL_MS } from "@/constants/ui";

const NO_HUB: FieldLinkStatusResponse = {
  hub_online: false,
  rc_connected: false,
  broker_connected: false,
  devices: [],
  connect_url: null,
  public_host: null,
};

export interface FieldLinkPoll {
  /** latest status; null until the first response. */
  status: FieldLinkStatusResponse | null;
  /** epoch ms of the last completed check (poll or manual), null until first. */
  lastChecked: number | null;
  /** a manual (operator-initiated) check is in flight; background polls don't set this. */
  checking: boolean;
  /** force an immediate re-check now (the heartbeat button). */
  refresh: () => Promise<void>;
}

/**
 * polls the field-link status while mounted (and on demand via refresh).
 * status is null until the first response; a failed check degrades to the
 * no-hub shape. consumers share one poll - don't call this twice on a page.
 */
export function useFieldLinkStatus(): FieldLinkPoll {
  const [status, setStatus] = useState<FieldLinkStatusResponse | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  // checking only flips for manual checks so the heartbeat button doesn't spin on every poll tick
  const runCheck = useCallback(async (manual: boolean) => {
    if (manual) setChecking(true);
    let next: FieldLinkStatusResponse;
    try {
      next = await getFieldLinkStatus();
    } catch {
      next = NO_HUB;
    }
    if (!mounted.current) return;
    setStatus(next);
    setLastChecked(Date.now());
    if (manual) setChecking(false);
  }, []);

  const refresh = useCallback(() => runCheck(true), [runCheck]);

  useEffect(() => {
    mounted.current = true;
    runCheck(false);
    const interval = setInterval(() => runCheck(false), FIELD_LINK_POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [runCheck]);

  return { status, lastChecked, checking, refresh };
}
