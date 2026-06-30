import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";

/** transient toast message with auto-dismiss; clears its timer on unmount. */
export default function useToast(timeoutMs: number = NOTIFICATION_TIMEOUT_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), timeoutMs);
  }, [timeoutMs]);

  return { message, show };
}
