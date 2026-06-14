import { describe, it, expect } from "vitest";
import en from "../locales/en.json";
import sk from "../locales/sk.json";

// i18next plural suffixes - english uses _one/_other, slovak adds _few/_many
const PLURAL_SUFFIXES = ["_zero", "_one", "_two", "_few", "_many", "_other"];

function stripPluralSuffix(key: string): string {
  /** drop the trailing CLDR plural suffix so en/sk plural variants compare as one base key. */
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

function flatten(obj: unknown, prefix = ""): Set<string> {
  /** flatten a nested translation object into dotted keys, normalizing plural suffixes. */
  const out = new Set<string>();
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const child of flatten(v, path)) out.add(child);
    } else {
      out.add(stripPluralSuffix(path));
    }
  }
  return out;
}

describe("locale parity guard - en.json vs sk.json", () => {
  it("every key in en.json has a slovak counterpart (modulo plural suffixes)", () => {
    /** prevents silent translation drops when en.json grows without sk.json catching up. */
    const enKeys = flatten(en);
    const skKeys = flatten(sk);
    const missingInSk = [...enKeys].filter((k) => !skKeys.has(k)).sort();
    expect(missingInSk).toEqual([]);
  });

  it("sk.json has no orphan keys that don't exist in en.json", () => {
    /** orphan slovak keys waste reviewer time and signal a renamed/removed en key. */
    const enKeys = flatten(en);
    const skKeys = flatten(sk);
    const orphansInSk = [...skKeys].filter((k) => !enKeys.has(k)).sort();
    expect(orphansInSk).toEqual([]);
  });
});
