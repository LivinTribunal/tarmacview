// shared badge color maps for the super-admin pages. one source of truth so
// role/status/action/entity-type chips stay consistent across users, airport
// detail, and audit-log views. values use --tv-* tokens verbatim.

const ACTION_FALLBACK: React.CSSProperties = {
  backgroundColor: "var(--tv-surface-hover)",
  color: "var(--tv-text-primary)",
};

const ENTITY_TYPE_FALLBACK: React.CSSProperties = {
  backgroundColor: "var(--tv-surface-hover)",
  color: "var(--tv-text-secondary)",
};

export const ROLE_BADGE: Record<string, React.CSSProperties> = {
  OPERATOR: { backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)", color: "var(--tv-success)" },
  COORDINATOR: { backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)", color: "var(--tv-warning)" },
  SUPER_ADMIN: { backgroundColor: "color-mix(in srgb, var(--tv-error) 20%, transparent)", color: "var(--tv-error)" },
};

// orphaned airport chip - no coordinator assigned, so coordinators/operators
// can't see or use it. warning-toned to read as "needs attention".
export const UNASSIGNED_BADGE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)",
  color: "var(--tv-warning)",
};

// warning-toned panel surface for orphaned / no-coordinator notices. shared so
// the detail-page banner and the assigned-users note read identically. the
// banner layers WARNING_SURFACE_BORDER on top for its outlined card variant.
export const WARNING_SURFACE: React.CSSProperties = {
  backgroundColor: "color-mix(in srgb, var(--tv-warning) 12%, transparent)",
  color: "var(--tv-warning)",
};

export const WARNING_SURFACE_BORDER = "color-mix(in srgb, var(--tv-warning) 40%, transparent)";

export const STATUS_BADGE: Record<string, React.CSSProperties> = {
  active: { backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)", color: "var(--tv-success)" },
  inactive: { backgroundColor: "color-mix(in srgb, var(--tv-error) 15%, transparent)", color: "var(--tv-error)" },
};

// union of every per-page ACTION key. shared keys agree on values across the
// three pages, so the union is conflict-free.
export const ACTION_BADGE: Record<string, React.CSSProperties> = {
  LOGIN: { backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)", color: "var(--tv-success)" },
  LOGOUT: { backgroundColor: "var(--tv-surface-hover)", color: "var(--tv-text-muted)" },
  CREATE: { backgroundColor: "color-mix(in srgb, var(--tv-accent) 20%, transparent)", color: "var(--tv-accent)" },
  UPDATE: { backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)", color: "var(--tv-warning)" },
  DELETE: { backgroundColor: "color-mix(in srgb, var(--tv-error) 20%, transparent)", color: "var(--tv-error)" },
  INVITE_USER: { backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)", color: "var(--tv-info)" },
  DEACTIVATE_USER: { backgroundColor: "color-mix(in srgb, var(--tv-error) 20%, transparent)", color: "var(--tv-error)" },
  ASSIGN_AIRPORT: { backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)", color: "var(--tv-info)" },
  SYSTEM_SETTING_CHANGE: { backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)", color: "var(--tv-warning)" },
  EXPORT: { backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)", color: "var(--tv-info)" },
  VALIDATE: { backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)", color: "var(--tv-success)" },
  GENERATE_TRAJECTORY: { backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)", color: "var(--tv-info)" },
};

export const ENTITY_TYPE_BADGE: Record<string, React.CSSProperties> = {
  User: { backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)", color: "var(--tv-info)" },
  Airport: { backgroundColor: "color-mix(in srgb, var(--tv-accent) 20%, transparent)", color: "var(--tv-accent)" },
  Mission: { backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)", color: "var(--tv-warning)" },
  DroneProfile: { backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)", color: "var(--tv-success)" },
  InspectionTemplate: { backgroundColor: "var(--tv-surface-hover)", color: "var(--tv-text-primary)" },
  SystemSettings: { backgroundColor: "color-mix(in srgb, var(--tv-error) 20%, transparent)", color: "var(--tv-error)" },
};

export function actionBadgeStyle(action: string | null | undefined): React.CSSProperties {
  /** action chip style with the shared surface-hover/text-primary fallback. */
  return (action ? ACTION_BADGE[action] : undefined) ?? ACTION_FALLBACK;
}

export function entityTypeBadgeStyle(entityType: string | null | undefined): React.CSSProperties {
  /** entity-type chip style with the shared surface-hover/text-secondary fallback. */
  return (entityType ? ENTITY_TYPE_BADGE[entityType] : undefined) ?? ENTITY_TYPE_FALLBACK;
}
