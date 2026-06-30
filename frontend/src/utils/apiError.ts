// surface fastapi's DomainError body: `{detail: "..."} | {detail: {message, ...}}`.

/** pull a human message out of an axios-style error body; null when none is present. */
export function extractApiErrorMessage(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof (detail as { message: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }
  return null;
}

/** same as extractApiErrorMessage but falls back to a generic string. */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return extractApiErrorMessage(err) ?? fallback;
}
