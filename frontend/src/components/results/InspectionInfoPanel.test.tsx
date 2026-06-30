import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { MeasurementResults } from "@/types/measurement";
import InspectionInfoPanel from "./InspectionInfoPanel";

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

const results: MeasurementResults = {
  id: "m1",
  inspection_id: "i1",
  status: "DONE",
  has_results: true,
  label: null,
  inspection_method: "HORIZONTAL_RANGE",
  inspection_sequence_order: 2,
  runway_heading: 94,
  reference_points: [],
  summaries: [],
  lights: [],
  drone_path: [],
  video_urls: {},
};

describe("InspectionInfoPanel", () => {
  it("renders the summary fields, verdict, status, and glide path", () => {
    render(
      <InspectionInfoPanel
        results={results}
        createdAt="2026-06-01T10:00:00Z"
        verdict="pass"
        glidePathAngle={3.0}
      />,
    );
    const panel = screen.getByTestId("results-inspection-info");
    expect(within(panel).getByText("Horizontal Range")).toBeInTheDocument();
    expect(within(panel).getByText("2")).toBeInTheDocument();
    expect(within(panel).getByText("94°")).toBeInTheDocument();
    expect(within(panel).getByText("3.00°")).toBeInTheDocument();
    // overall verdict pill
    expect(within(panel).getByText("PASS")).toBeInTheDocument();
    // status chip resolves the DONE label
    expect(within(panel).getByText("Done")).toBeInTheDocument();
  });

  it("falls back to the unavailable label when no glide path", () => {
    render(
      <InspectionInfoPanel
        results={results}
        createdAt={null}
        verdict="pending"
        glidePathAngle={null}
      />,
    );
    expect(screen.getByText("Not available")).toBeInTheDocument();
  });

  it("collapses on header click", () => {
    render(
      <InspectionInfoPanel
        results={results}
        createdAt="2026-06-01T10:00:00Z"
        verdict="pass"
        glidePathAngle={3.0}
      />,
    );
    expect(screen.getByText("Horizontal Range")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Inspection Info"));
    expect(screen.queryByText("Horizontal Range")).toBeNull();
  });
});
