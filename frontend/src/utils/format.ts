/** display-only number formatting helpers. */

/** format a number to a fixed decimal string, empty string for null/undefined. */
export function formatNumber(value: number | null | undefined, decimals: number): string {
  if (value == null || Number.isNaN(value)) return "";
  return value.toFixed(decimals);
}

/** format an iso date string for display. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** format seconds as m:ss duration string. */
export function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** format seconds as verbose duration string (e.g. "5 min", "1h 30m"); em-dash for null. */
export function formatDurationLong(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}
