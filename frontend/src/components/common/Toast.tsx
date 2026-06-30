import type { ReactNode } from "react";
import ToastShell from "@/components/common/ToastShell";

interface ToastProps {
  message: ReactNode;
}

/** simple text toast in the bottom-right corner. */
export default function Toast({ message }: ToastProps) {
  return (
    <ToastShell className="px-4 py-3 text-sm text-tv-text-primary">
      {message}
    </ToastShell>
  );
}
