import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { HelpCircle } from "lucide-react";

interface InfoHintProps {
  text: string;
  label?: string;
  className?: string;
  testId?: string;
}

// matches tailwind w-56
const POPOVER_WIDTH = 224;
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 4;

export default function InfoHint({
  text,
  label,
  className = "",
  testId,
}: InfoHintProps) {
  /** small ?-icon trigger that surfaces field-level help on hover, click, or focus. */
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const suppressFocusOpen = useRef(false);
  const popoverId = useId();

  // outside-click + escape dismissal
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // viewport-aware positioning while open
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const popoverH = popoverRef.current?.offsetHeight ?? 0;
      const popoverW = popoverRef.current?.offsetWidth || POPOVER_WIDTH;

      let top = rect.bottom + TRIGGER_GAP;
      // flip above if no room below and there's room above
      const overflowsBelow = top + popoverH + VIEWPORT_MARGIN > viewportH;
      const fitsAbove = rect.top - TRIGGER_GAP - popoverH >= VIEWPORT_MARGIN;
      if (overflowsBelow && fitsAbove) {
        top = rect.top - TRIGGER_GAP - popoverH;
      }

      let left = rect.left + rect.width / 2 - popoverW / 2;
      const maxLeft = viewportW - popoverW - VIEWPORT_MARGIN;
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, Math.max(VIEWPORT_MARGIN, maxLeft)));

      setPosition({ top, left });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      // trigger already holds focus; suppress the next focus event so the
      // popover doesn't immediately reopen via onFocus
      suppressFocusOpen.current = true;
      triggerRef.current?.focus();
    }
  }

  return (
    <span
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ?? t("common.showHelp")}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-describedby={open ? popoverId : undefined}
        onClick={(e) => {
          e.preventDefault();
          setOpen((prev) => !prev);
        }}
        onFocus={() => {
          if (suppressFocusOpen.current) {
            suppressFocusOpen.current = false;
            return;
          }
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-tv-text-muted hover:text-tv-text-secondary focus:outline-none focus:text-tv-accent transition-colors"
        data-testid={testId}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <span
            ref={popoverRef}
            id={popoverId}
            role="tooltip"
            style={{
              position: "fixed",
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            className="z-[60] w-56 rounded-xl border border-tv-border bg-tv-surface px-3 py-2 text-[11px] leading-snug text-tv-text-primary shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
