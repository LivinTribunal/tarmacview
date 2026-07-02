/** shared field-definition layer consumed by both the read-only poi panels and
 * the coordinator edit panels so field set, labels, ordering, and formatting
 * live in one place and cannot drift. */

export type TFn = (key: string, opts?: Record<string, unknown>) => string;

export type Datum = "MSL" | "AGL" | null;

export interface FeatureFieldDef<T> {
  // data column key - matches the ORM/response field so edit panels can look it up
  key: string;
  // canonical featureFields.* label key, shared by read + edit
  labelKey: string;
  // final display string incl. units/datum for the read panel; null skips the row.
  // entries without a formatter are label-only (edit panels reference labelKey).
  read?: (entity: T, t: TFn) => string | null;
  // gate a read row on the entity (e.g. PAPI-only)
  visible?: (entity: T) => boolean;
}

/** look up a field's label key by data-column key; falls back to the key itself. */
export function labelKeyOf<T>(defs: FeatureFieldDef<T>[], key: string): string {
  return defs.find((d) => d.key === key)?.labelKey ?? key;
}
