import { describe, it, expect } from "vitest";
import {
  ROLE_BADGE,
  STATUS_BADGE,
  ACTION_BADGE,
  ENTITY_TYPE_BADGE,
  WARNING_SURFACE,
  WARNING_SURFACE_BORDER,
  actionBadgeStyle,
  entityTypeBadgeStyle,
} from "./badgeStyles";

describe("badgeStyles shared maps", () => {
  /** the consolidated maps must preserve every prior per-key style verbatim. */
  it("preserves representative ROLE_BADGE styles", () => {
    expect(ROLE_BADGE.OPERATOR).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)",
      color: "var(--tv-success)",
    });
    expect(ROLE_BADGE.SUPER_ADMIN).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-error) 20%, transparent)",
      color: "var(--tv-error)",
    });
  });

  it("preserves representative STATUS_BADGE styles", () => {
    expect(STATUS_BADGE.active).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-success) 20%, transparent)",
      color: "var(--tv-success)",
    });
    expect(STATUS_BADGE.inactive).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-error) 15%, transparent)",
      color: "var(--tv-error)",
    });
  });

  it("unions every ACTION_BADGE key across the three pages without conflict", () => {
    // shared keys (users + audit-log) keep their original values
    expect(ACTION_BADGE.LOGOUT).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-muted)",
    });
    expect(ACTION_BADGE.SYSTEM_SETTING_CHANGE).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)",
      color: "var(--tv-warning)",
    });
    // airport-detail-only keys survive the union
    expect(ACTION_BADGE.EXPORT).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)",
      color: "var(--tv-info)",
    });
    expect(ACTION_BADGE.GENERATE_TRAJECTORY).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)",
      color: "var(--tv-info)",
    });
  });

  it("preserves representative ENTITY_TYPE_BADGE styles", () => {
    expect(ENTITY_TYPE_BADGE.User).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-info) 20%, transparent)",
      color: "var(--tv-info)",
    });
    expect(ENTITY_TYPE_BADGE.InspectionTemplate).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-primary)",
    });
  });

  it("exposes the shared warning-surface style for orphaned / no-coordinator notices", () => {
    expect(WARNING_SURFACE).toEqual({
      backgroundColor: "color-mix(in srgb, var(--tv-warning) 12%, transparent)",
      color: "var(--tv-warning)",
    });
    expect(WARNING_SURFACE_BORDER).toBe("color-mix(in srgb, var(--tv-warning) 40%, transparent)");
  });

  it("returns the known style for a mapped action and the fallback otherwise", () => {
    expect(actionBadgeStyle("LOGIN")).toEqual(ACTION_BADGE.LOGIN);
    expect(actionBadgeStyle("__UNKNOWN__")).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-primary)",
    });
    expect(actionBadgeStyle(null)).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-primary)",
    });
  });

  it("returns the known style for a mapped entity type and the fallback otherwise", () => {
    expect(entityTypeBadgeStyle("Airport")).toEqual(ENTITY_TYPE_BADGE.Airport);
    expect(entityTypeBadgeStyle("__UNKNOWN__")).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-secondary)",
    });
    expect(entityTypeBadgeStyle(undefined)).toEqual({
      backgroundColor: "var(--tv-surface-hover)",
      color: "var(--tv-text-secondary)",
    });
  });
});
