import type { CSSProperties } from "react";
import { ALL_INSPECTION_METHODS } from "@/utils/methodAglCompatibility";

// the per-method --tv-method-*-bg/text pairs in index.css are the single
// source of truth; the badge style derives its var names from the method slug.
const KNOWN_METHODS = new Set<string>(ALL_INSPECTION_METHODS);

/** inline bg/text styles for an inspection-method badge, derived from the
 * method slug. unknown methods get no styling. */
export function methodBadgeStyle(method: string): CSSProperties {
  if (!KNOWN_METHODS.has(method)) return {};
  const slug = method.toLowerCase().replace(/_/g, "-");
  return {
    backgroundColor: `var(--tv-method-${slug}-bg)`,
    color: `var(--tv-method-${slug}-text)`,
  };
}
