/** shared utilities for violation message display. */

/** strip legacy [SUGGESTION] prefix - new code uses category='suggestion',
 * but pre-migration DB rows may still carry the prefix.
 */
export function cleanMessage(message: string): string {
  return message.replace(/^\[SUGGESTION\]\s*/i, "");
}

const SNAKE_OR_KEBAB = /[_-]+/g;

/** turn machine-style constraint names ("speed_limit", "obstacle-clearance")
 * into a short human label, falling back to a trimmed message excerpt.
 */
export function humanizeConstraintLabel(
  constraintName: string | null,
  fallbackMessage: string,
): string {
  if (constraintName && constraintName.trim().length > 0) {
    const normalized = constraintName.trim().replace(SNAKE_OR_KEBAB, " ").toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  const cleaned = cleanMessage(fallbackMessage).trim();
  if (cleaned.length <= 80) return cleaned;
  return cleaned.slice(0, 77).trimEnd() + "...";
}
