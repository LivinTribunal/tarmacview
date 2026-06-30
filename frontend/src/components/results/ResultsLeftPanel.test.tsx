import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type {
  LightSeries,
  MeasurementListItem,
  MeasurementResults,
} from "@/types/measurement";
import ResultsLeftPanel, { overallVerdict } from "./ResultsLeftPanel";

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
  let s = resolveKey(key);
  if (typeof opts === "string") return s === key ? opts : s;
  if (opts && typeof opts === "object") {
    for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
      s = s.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    }
  }
  return s;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

function light(over: Partial<LightSeries>): LightSeries {
  return {
    light_name: "PAPI_A",
    setting_angle: null,
    tolerance: null,
    transition_angle_min: null,
    transition_angle_middle: null,
    transition_angle_max: null,
    passed: null,
    points: [],
    ...over,
  };
}

const SECTIONS = [
  { id: "papi-vertical", labelKey: "results.sections.vertical" },
  { id: "papi-horizontal", labelKey: "results.sections.horizontal" },
] as const;

function results(over: Partial<MeasurementResults>): MeasurementResults {
  return {
    id: "m1",
    inspection_id: "i1",
    status: "DONE",
    has_results: true,
    label: null,
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    runway_heading: 90,
    reference_points: [],
    summaries: [],
    lights: [],
    drone_path: [],
    video_urls: {},
    ...over,
  };
}

function listRow(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-a",
    mission_name: "Alpha",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
    label: null,
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 1,
    fail_count: 0,
    error_message: null,
    ...over,
  };
}

describe("overallVerdict", () => {
  it("is pending when nothing is scored", () => {
    expect(overallVerdict([])).toBe("pending");
    expect(
      overallVerdict([
        {
          light_name: "PAPI_A",
          setting_angle: null,
          tolerance: null,
          measured_transition_angle: null,
          passed: null,
        },
      ]),
    ).toBe("pending");
  });

  it("fails when any scored light failed, else passes", () => {
    const base = {
      setting_angle: 3,
      tolerance: 0.5,
      measured_transition_angle: 3.1,
    };
    expect(
      overallVerdict([
        { light_name: "PAPI_A", ...base, passed: true },
        { light_name: "PAPI_B", ...base, passed: false },
      ]),
    ).toBe("fail");
    expect(
      overallVerdict([{ light_name: "PAPI_A", ...base, passed: true }]),
    ).toBe("pass");
  });
});

describe("ResultsLeftPanel", () => {
  it("renders the summary, verdict, per-PAPI rows, glide path, and section nav", () => {
    const data = results({
      summaries: [
        {
          light_name: "PAPI_A",
          setting_angle: 3.0,
          tolerance: 0.5,
          measured_transition_angle: 3.1,
          passed: true,
        },
        {
          light_name: "PAPI_B",
          setting_angle: 3.0,
          tolerance: 0.5,
          measured_transition_angle: 4.0,
          passed: false,
        },
      ],
      lights: [
        light({ light_name: "PAPI_B", transition_angle_max: 3.2 }),
        light({ light_name: "PAPI_C", transition_angle_min: 2.8 }),
      ],
    });

    render(
      <ResultsLeftPanel
        results={data}
        currentRow={listRow({})}
        sections={SECTIONS}
      />,
    );

    // summary card carries method / heading / processed date
    const summary = screen.getByTestId("results-summary-card");
    expect(within(summary).getByText("Horizontal Range")).toBeInTheDocument();
    expect(within(summary).getByText("90°")).toBeInTheDocument();

    // overall verdict is FAIL (one scored light failed)
    expect(
      within(screen.getByTestId("results-overall-verdict")).getByText("FAIL"),
    ).toBeInTheDocument();

    // one per-PAPI row per present summary
    const perPapi = screen.getByTestId("results-per-papi");
    expect(within(perPapi).getByText("PAPI_A")).toBeInTheDocument();
    expect(within(perPapi).getByText("PAPI_B")).toBeInTheDocument();

    // glide path = midpoint of B.max + C.min
    expect(
      within(screen.getByTestId("results-glide-path")).getByText("3.00°"),
    ).toBeInTheDocument();

    // one nav button per section entry
    const nav = screen.getByTestId("results-section-nav");
    expect(within(nav).getAllByRole("button")).toHaveLength(SECTIONS.length);
  });

  it("shows the empty per-PAPI state when there are no summaries", () => {
    render(
      <ResultsLeftPanel
        results={results({})}
        currentRow={null}
        sections={SECTIONS}
      />,
    );
    expect(
      within(screen.getByTestId("results-per-papi")).getByText(
        "No per-light summaries available.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("results-glide-path")).getByText("Not available"),
    ).toBeInTheDocument();
  });
});
