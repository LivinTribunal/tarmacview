import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { InspectionResponse } from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type {
  LightSeries,
  MeasurementListItem,
  MeasurementResults,
} from "@/types/measurement";
import ResultsLeftPanel, {
  computeGlidePathAngle,
  overallVerdict,
} from "./ResultsLeftPanel";

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

function inspection(over: Partial<InspectionResponse>): InspectionResponse {
  return {
    id: "i1",
    mission_id: "mission-a",
    template_id: "tpl-1",
    config_id: null,
    method: "HORIZONTAL_RANGE",
    sequence_order: 1,
    lha_ids: null,
    config: null,
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

const templates = new Map<string, InspectionTemplateResponse>([
  [
    "tpl-1",
    {
      id: "tpl-1",
      name: "PAPI North",
      description: null,
      angular_tolerances: null,
      created_by: null,
      created_at: null,
      updated_at: null,
      default_config: null,
      target_agl_ids: [],
      methods: ["HORIZONTAL_RANGE"],
      mission_count: 0,
    },
  ],
]);

describe("computeGlidePathAngle", () => {
  it("returns the midpoint of B.max and C.min when both present", () => {
    const lights = [
      light({ light_name: "PAPI_B", transition_angle_max: 3.2 }),
      light({ light_name: "PAPI_C", transition_angle_min: 2.8 }),
    ];
    expect(computeGlidePathAngle(lights)).toBeCloseTo(3.0);
  });

  it("returns null when either transition is missing or the lights are absent", () => {
    expect(
      computeGlidePathAngle([light({ light_name: "PAPI_B", transition_angle_max: 3.2 })]),
    ).toBeNull();
    expect(computeGlidePathAngle([])).toBeNull();
  });
});

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
  const inspections = [inspection({})];
  const byInspection = new Map([["i1", listRow({})]]);

  it("renders the picker, inspection info, and per-LHA rows; no summary card or section nav", () => {
    const data = results({
      summaries: [
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
        inspections={inspections}
        templates={templates}
        measurementByInspection={byInspection}
        selectedId="i1"
        onSelect={vi.fn()}
        results={data}
        currentRow={listRow({})}
      />,
    );

    // picker lists one row per inspection
    expect(screen.getByTestId("results-inspection-picker")).toBeInTheDocument();
    expect(screen.getByTestId("results-inspection-row-i1")).toBeInTheDocument();

    // inspection info carries verdict + glide path + processed date
    const info = screen.getByTestId("results-inspection-info");
    expect(within(info).getByText("FAIL")).toBeInTheDocument();
    expect(within(info).getByText("3.00°")).toBeInTheDocument();
    expect(within(info).getByText("Horizontal Range")).toBeInTheDocument();

    // per-LHA renders one row per light in lights[]
    const perLha = screen.getByTestId("results-per-lha");
    expect(within(perLha).getByText("PAPI_B")).toBeInTheDocument();
    expect(within(perLha).getByText("PAPI_C")).toBeInTheDocument();

    // legacy summary card + section nav are gone
    expect(screen.queryByTestId("results-summary-card")).toBeNull();
    expect(screen.queryByTestId("results-section-nav")).toBeNull();
  });

  it("shows only the picker when no inspection results are loaded", () => {
    render(
      <ResultsLeftPanel
        inspections={inspections}
        templates={templates}
        measurementByInspection={byInspection}
        selectedId={null}
        onSelect={vi.fn()}
        results={null}
        currentRow={null}
      />,
    );
    expect(screen.getByTestId("results-inspection-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("results-inspection-info")).toBeNull();
    expect(screen.queryByTestId("results-per-lha")).toBeNull();
  });

  it("shows the empty per-LHA state when there are no lights", () => {
    render(
      <ResultsLeftPanel
        inspections={inspections}
        templates={templates}
        measurementByInspection={byInspection}
        selectedId="i1"
        onSelect={vi.fn()}
        results={results({ lights: [] })}
        currentRow={listRow({})}
      />,
    );
    expect(
      within(screen.getByTestId("results-per-lha")).getByText(
        "No per-light summaries available.",
      ),
    ).toBeInTheDocument();
  });
});
