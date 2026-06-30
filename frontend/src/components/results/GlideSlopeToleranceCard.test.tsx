import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import GlideSlopeToleranceCard from "./GlideSlopeToleranceCard";

/** resolve a dotted i18n key against the real en.json bundle. */
function resolveKey(key: string): string {
  const parts = key.split(".");
  let node: unknown = en as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

const stableT = (key: string, opts?: unknown) => {
  const s = resolveKey(key);
  if (typeof opts === "string") return s === key ? opts : s;
  return s;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

describe("GlideSlopeToleranceCard", () => {
  it("renders measured + configured±tolerance and an OK pill when within tolerance", () => {
    render(
      <GlideSlopeToleranceCard
        measured={3.0}
        configured={3.0}
        tolerance={0.1}
        withinTolerance={true}
      />,
    );
    const card = screen.getByTestId("results-glide-slope-tolerance");
    expect(card.textContent).toContain("3.00°");
    expect(card.textContent).toContain("3.00±0.10°");
    expect(card.textContent).toContain(en.results.glideSlopeTolerance.ok);
  });

  it("renders a sub-0.1 tolerance band faithfully (no toFixed(1) truncation)", () => {
    render(
      <GlideSlopeToleranceCard
        measured={3.13}
        configured={3.0}
        tolerance={0.15}
        withinTolerance={true}
      />,
    );
    const card = screen.getByTestId("results-glide-slope-tolerance");
    // the displayed band must reflect the real ±0.15, not a truncated ±0.1
    expect(card.textContent).toContain("3.00±0.15°");
    expect(card.textContent).not.toContain("±0.1°");
  });

  it("shows the out-of-tolerance pill when the verdict is false", () => {
    render(
      <GlideSlopeToleranceCard
        measured={3.5}
        configured={3.0}
        tolerance={0.1}
        withinTolerance={false}
      />,
    );
    expect(
      screen.getByText(en.results.glideSlopeTolerance.outOfTolerance),
    ).toBeInTheDocument();
  });

  it("shows the unavailable pill and em-dash placeholders when values are null", () => {
    render(
      <GlideSlopeToleranceCard
        measured={null}
        configured={null}
        tolerance={null}
        withinTolerance={null}
      />,
    );
    const card = screen.getByTestId("results-glide-slope-tolerance");
    expect(card.textContent).toContain("—");
    expect(
      screen.getByText(en.results.glideSlopeTolerance.unavailable),
    ).toBeInTheDocument();
  });
});
