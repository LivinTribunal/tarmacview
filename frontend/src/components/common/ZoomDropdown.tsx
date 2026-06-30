import { useState, useRef, useEffect } from "react";

interface ZoomDropdownProps {
  zoomPercent: number;
  onZoomTo: (percent: number) => void;
  ariaLabel: string;
  presets?: number[];
  maxPercent?: number;
  className?: string;
}

const DEFAULT_PRESETS = [50, 75, 100, 150, 200, 300];

/** zoom %-field with a preset dropdown and a custom-percent input. */
export default function ZoomDropdown({
  zoomPercent,
  onZoomTo,
  ariaLabel,
  presets = DEFAULT_PRESETS,
  maxPercent = 1000,
  className,
}: ZoomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [zoomInput, setZoomInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      /** close dropdown on outside click. */
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleZoomInputSubmit() {
    /** parse custom zoom input and apply if in range. */
    const val = parseInt(zoomInput, 10);
    if (!isNaN(val) && val > 0 && val <= maxPercent) {
      onZoomTo(val);
    }
    setZoomInput("");
    setOpen(false);
  }

  return (
    <div className={`relative ${className ?? ""}`.trim()} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-16 text-center text-xs rounded-full px-2 py-1.5 border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
        data-testid="zoom-field"
      >
        {Math.round(zoomPercent)}%
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 w-24 rounded-2xl border border-tv-border bg-tv-bg p-1 z-20">
          {presets.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => { onZoomTo(p); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs rounded-xl text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            >
              {p}%
            </button>
          ))}
          <div className="border-t border-tv-border mt-1 pt-1">
            <input
              value={zoomInput}
              onChange={(e) => setZoomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleZoomInputSubmit(); }}
              placeholder="%"
              aria-label={ariaLabel}
              className="w-full px-3 py-1 text-xs rounded-xl bg-tv-bg border border-tv-border text-tv-text-primary outline-none"
              data-testid="zoom-input"
            />
          </div>
        </div>
      )}
    </div>
  );
}
