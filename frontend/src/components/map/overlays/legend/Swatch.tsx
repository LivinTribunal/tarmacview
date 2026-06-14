import type { LegendItem } from "./legendEntries";

/** small chevron indicator for collapsible legend sections. */
export function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 text-tv-text-muted transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** renders a swatch icon based on type. */
export function Swatch({ item }: { item: LegendItem }) {
  const s = item.size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  if (item.swatch === "rectangle") {
    return (
      <span
        className={`inline-block ${s} rounded-sm`}
        style={{ backgroundColor: item.color }}
      />
    );
  }

  // runway - gray rectangle with white dashed centerline
  if (item.swatch === "runway") {
    return (
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 10 10">
        <rect x="1" y="0" width="8" height="10" rx="1" fill={item.color} />
        <line x1="5" y1="1" x2="5" y2="9" stroke="white" strokeWidth="0.8" strokeDasharray="1.5 1" />
      </svg>
    );
  }

  // taxiway - yellowish rectangle with black dashed centerline (vertical like runway)
  if (item.swatch === "taxiway") {
    return (
      <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 10 10">
        <rect x="1" y="0" width="8" height="10" rx="1" fill={item.color} />
        <line x1="5" y1="1" x2="5" y2="9" stroke="#1a1a1a" strokeWidth="0.7" strokeDasharray="1.5 1" />
      </svg>
    );
  }

  if (item.swatch === "dashed-rectangle") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <rect
          x="0.5" y="0.5" width="9" height="9" rx="1"
          fill="none"
          stroke={item.color}
          strokeWidth="1.2"
          strokeDasharray="2.5 1.5"
        />
      </svg>
    );
  }

  if (item.swatch === "dashed-hatch") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <rect
          x="0.5" y="0.5" width="9" height="9" rx="1"
          fill={item.color + "20"}
          stroke={item.color}
          strokeWidth="1"
          strokeDasharray="2 1"
        />
        <line x1="0" y1="10" x2="10" y2="0" stroke={item.color} strokeWidth="0.7" opacity="0.5" />
        <line x1="-3" y1="7" x2="7" y2="-3" stroke={item.color} strokeWidth="0.7" opacity="0.5" />
        <line x1="3" y1="13" x2="13" y2="3" stroke={item.color} strokeWidth="0.7" opacity="0.5" />
      </svg>
    );
  }

  if (item.swatch === "triangle") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <polygon points="5,1 9,9 1,9" fill={item.color} />
      </svg>
    );
  }

  if (item.swatch === "tower") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <line x1="3" y1="9" x2="4.5" y2="3.5" stroke={item.color} strokeWidth="0.8" strokeLinecap="round" />
        <line x1="7" y1="9" x2="5.5" y2="3.5" stroke={item.color} strokeWidth="0.8" strokeLinecap="round" />
        <line x1="3.5" y1="6.5" x2="6.5" y2="6.5" stroke={item.color} strokeWidth="0.5" />
        <line x1="4" y1="3.5" x2="6" y2="3.5" stroke={item.color} strokeWidth="0.7" strokeLinecap="round" />
        <line x1="5" y1="3.5" x2="5" y2="1" stroke={item.color} strokeWidth="0.6" strokeLinecap="round" />
        <circle cx="5" cy="1" r="0.5" fill={item.color} />
      </svg>
    );
  }

  if (item.swatch === "antenna") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <line x1="5" y1="9" x2="5" y2="2" stroke={item.color} strokeWidth="0.8" strokeLinecap="round" />
        <line x1="3.5" y1="9" x2="6.5" y2="9" stroke={item.color} strokeWidth="0.7" strokeLinecap="round" />
        <path d="M3.5,4 A2,2 0 0,1 5,2.5" fill="none" stroke={item.color} strokeWidth="0.5" />
        <path d="M6.5,4 A2,2 0 0,0 5,2.5" fill="none" stroke={item.color} strokeWidth="0.5" />
        <path d="M2.5,5 A3.5,3.5 0 0,1 5,2" fill="none" stroke={item.color} strokeWidth="0.5" />
        <path d="M7.5,5 A3.5,3.5 0 0,0 5,2" fill="none" stroke={item.color} strokeWidth="0.5" />
        <circle cx="5" cy="2" r="0.5" fill={item.color} />
      </svg>
    );
  }

  if (item.swatch === "tree") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <rect x="4.2" y="6" width="1.6" height="3" rx="0.3" fill="#8B6914" />
        <polygon points="5,1 7.5,5 2.5,5" fill={item.color} />
        <polygon points="5,2.5 8,6.5 2,6.5" fill={item.color} />
      </svg>
    );
  }

  // rounded square with letter - matches takeoff/landing map icons
  if (item.swatch === "rounded-square-letter") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <rect x="1" y="1" width="8" height="8" rx="2" fill={item.color} stroke="#ffffff" strokeWidth="0.6" />
        <text x="5" y="5.5" textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize="5" fontWeight="bold">
          {item.letter}
        </text>
      </svg>
    );
  }

  // hover icon - circle with pause bars
  if (item.swatch === "hover-icon") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <circle cx="5" cy="5" r="4" fill={item.color} stroke="#ffffff" strokeWidth="0.5" />
        <rect x="3.5" y="3.2" width="1" height="3.6" rx="0.2" fill="#ffffff" />
        <rect x="5.5" y="3.2" width="1" height="3.6" rx="0.2" fill="#ffffff" />
      </svg>
    );
  }

  // line with chevron arrow - matches transit path direction indicators
  if (item.swatch === "line-arrow") {
    return (
      <svg className={s} viewBox="0 0 10 10">
        <line x1="0" y1="5" x2="10" y2="5" stroke={item.color} strokeWidth="2" />
        <polyline points="5,2.5 8,5 5,7.5" fill="none" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // circle with white outline - matches measurement waypoints
  if (item.swatch === "circle-outline") {
    return (
      <span
        className={`inline-block ${s} rounded-full`}
        style={{
          backgroundColor: item.color,
          border: "1.5px solid #ffffff",
          boxShadow: "0 0 0 0.5px var(--tv-text-muted)",
        }}
      />
    );
  }

  // white circle with gray border - matches transit waypoints
  if (item.swatch === "circle-border") {
    return (
      <span
        className={`inline-block ${s} rounded-full`}
        style={{
          backgroundColor: item.color,
          border: "1.5px solid #6b6b6b",
        }}
      />
    );
  }

  // circle
  return (
    <span
      className={`inline-block ${s} rounded-full`}
      style={{ backgroundColor: item.color }}
    />
  );
}
