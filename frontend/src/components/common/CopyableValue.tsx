import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface CopyableValueProps {
  // raw value written to the clipboard - no units, no commas
  text: string;
  // optional display node; falls back to `text`
  children?: ReactNode;
  className?: string;
}

const FEEDBACK_MS = 1500;

export default function CopyableValue({
  text,
  children,
  className,
}: CopyableValueProps) {
  /** click/keyboard-to-copy a raw value with brief inline "copied" feedback. */
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function copy(e: React.MouseEvent | React.KeyboardEvent) {
    // stop the row's own select/edit/expand handler from also firing
    e.stopPropagation();
    navigator.clipboard?.writeText(text);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copy(e);
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={copy}
      onKeyDown={handleKeyDown}
      data-testid="copyable-value"
      className={`cursor-pointer rounded text-tv-text-primary-soft outline-none transition-colors duration-150 hover:text-tv-text-primary-hover focus-visible:ring-2 focus-visible:ring-tv-accent ${
        className ?? ""
      }`}
    >
      {copied ? t("common.copied") : (children ?? text)}
    </span>
  );
}
