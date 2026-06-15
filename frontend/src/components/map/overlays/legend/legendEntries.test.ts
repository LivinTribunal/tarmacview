import { describe, expect, it } from "vitest";
import {
  STATUSES_WITH_FULL_WAYPOINTS,
  allWaypointItems,
  obstacleItems,
  papiItems,
  relItems,
  surfaceItems,
  takeoffLandingItems,
  zoneItems,
} from "./legendEntries";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const ALL_GROUPS = [
  surfaceItems,
  zoneItems,
  obstacleItems,
  papiItems,
  relItems,
  takeoffLandingItems,
  allWaypointItems,
];

describe("legendEntries", () => {
  it("every entry has a non-empty key and i18nKey", () => {
    for (const group of ALL_GROUPS) {
      expect(group.length).toBeGreaterThan(0);
      for (const item of group) {
        expect(item.key).toMatch(/\S/);
        expect(item.i18nKey).toMatch(/\S/);
      }
    }
  });

  it("every entry carries a 6-digit hex color", () => {
    for (const group of ALL_GROUPS) {
      for (const item of group) {
        expect(item.color).toMatch(HEX_COLOR);
      }
    }
  });

  it("allWaypointItems contains the takeoff/landing entries", () => {
    const keys = allWaypointItems.map((i) => i.key);
    expect(keys).toContain("takeoff");
    expect(keys).toContain("landing");
  });

  it("rounded-square-letter entries carry a letter", () => {
    for (const item of takeoffLandingItems) {
      expect(item.swatch).toBe("rounded-square-letter");
      expect(item.letter).toMatch(/^[A-Z]$/);
    }
  });

  it("full-waypoints statuses cover the post-planning lifecycle", () => {
    expect(STATUSES_WITH_FULL_WAYPOINTS).toEqual([
      "PLANNED",
      "VALIDATED",
      "EXPORTED",
      "MEASURED",
      "COMPLETED",
    ]);
  });
});
