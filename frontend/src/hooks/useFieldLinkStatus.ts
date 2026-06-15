import { useEffect, useState } from "react";
import { getFieldLinkStatus } from "@/api/fieldLink";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";
import { FIELD_LINK_POLL_INTERVAL_MS } from "@/constants/ui";

const NO_HUB: FieldLinkStatusResponse = {
  hub_online: false,
  broker_connected: false,
  devices: [],
  connect_url: null,
  public_host: null,
};

/**
 * polls the field-link status while mounted. null until the first
 * response; a failed poll degrades to the no-hub shape.
 */
export function useFieldLinkStatus(): FieldLinkStatusResponse | null {
  const [status, setStatus] = useState<FieldLinkStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const next = await getFieldLinkStatus();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(NO_HUB);
      }
    }

    poll();
    const interval = setInterval(poll, FIELD_LINK_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}
