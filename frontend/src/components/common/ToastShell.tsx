import type { ReactNode } from "react";

interface ToastShellProps {
  children: ReactNode;
  className?: string;
  testId?: string;
}

/** bottom-right fixed toast container. */
export default function ToastShell({ children, className, testId }: ToastShellProps) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 rounded-2xl bg-tv-surface border border-tv-border ${className ?? ""}`.trim()}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
