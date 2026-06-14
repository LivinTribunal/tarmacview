/** drone silhouette placeholder svg. */
export default function DronePlaceholderIcon() {
  return (
    <svg
      className="h-16 w-16 text-[var(--tv-text-muted)]"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="32" cy="32" r="4" />
      <line x1="32" y1="28" x2="18" y2="14" />
      <line x1="32" y1="28" x2="46" y2="14" />
      <line x1="32" y1="36" x2="18" y2="50" />
      <line x1="32" y1="36" x2="46" y2="50" />
      <circle cx="18" cy="14" r="6" />
      <circle cx="46" cy="14" r="6" />
      <circle cx="18" cy="50" r="6" />
      <circle cx="46" cy="50" r="6" />
    </svg>
  );
}
