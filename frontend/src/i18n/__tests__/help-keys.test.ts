import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import en from "../locales/en.json";

// components touched by issue #365 - guard their t("...Help") references
// against accidental typos / missing copy in en.json.
const COMPONENT_FILES = [
  "frontend/src/components/mission/InspectionConfigForm.tsx",
  "frontend/src/components/mission/CaptureModeSection.tsx",
  "frontend/src/components/mission/DirectionSection.tsx",
  "frontend/src/components/mission/FlightParametersSection.tsx",
  "frontend/src/components/mission/LhaSelectionSection.tsx",
  "frontend/src/components/mission/MethodSpecificSections.tsx",
  "frontend/src/components/mission/MissionConfigForm.tsx",
  "frontend/src/components/mission/TemplateAglSection.tsx",
  "frontend/src/components/mission/TemplateConfigSection.tsx",
  "frontend/src/components/coordinator/CreationForm.tsx",
  "frontend/src/components/coordinator/EditableFeatureInfo.tsx",
  "frontend/src/components/coordinator/TerrainSettingsCard.tsx",
  "frontend/src/components/coordinator/CreateAirportDialog.tsx",
  "frontend/src/components/map/overlays/AGLPanel.tsx",
  "frontend/src/components/coordinator/MapCoordinatePicker.tsx",
  "frontend/src/components/coordinator/AirportInfoPanel.tsx",
];

const HELP_KEY_REGEX = /t\(\s*["']([\w.]+Help)["']/g;

function repoFile(relPath: string): string {
  /** read a repo-rooted path relative to the frontend package. */
  const root = resolve(__dirname, "..", "..", "..", "..");
  return readFileSync(resolve(root, relPath), "utf-8");
}

function lookup(obj: unknown, dottedKey: string): unknown {
  /** walk a nested object via dot path; return undefined if any segment misses. */
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

describe("issue #365 - help-key guard", () => {
  it("every t(...Help) reference in touched components resolves in en.json", () => {
    const missing: { file: string; key: string }[] = [];
    for (const file of COMPONENT_FILES) {
      const src = repoFile(file);
      for (const match of src.matchAll(HELP_KEY_REGEX)) {
        const key = match[1];
        const value = lookup(en, key);
        if (typeof value !== "string" || value.trim() === "") {
          missing.push({ file, key });
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
