import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import TemplateAglSection from "./TemplateAglSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function makeLha(seq: number, lon = 14.27): LHAResponse {
  return {
    id: `lha-${seq}`,
    agl_id: "agl-1",
    unit_designator: String(seq),
    setting_angle: 0,
    transition_sector_width: null,
    lamp_type: "HALOGEN",
    position: { type: "Point", coordinates: [lon, 50.1, 0] },
    tolerance: null,
    sequence_number: seq,
    lens_height_msl_m: null,
    lens_height_agl_m: null,
  };
}

function makeAgl(count: number): AGLResponse {
  return {
    id: "agl-1",
    surface_id: "surface-1",
    agl_type: "RUNWAY_EDGE_LIGHTS",
    name: "Edge",
    position: { type: "Point", coordinates: [14.27, 50.1, 0] },
    side: null,
    glide_slope_angle: null,
    glide_slope_angle_tolerance: null,
    distance_from_threshold: null,
    offset_from_centerline: null,
    lhas: Array.from({ length: count }, (_, i) =>
      makeLha(i + 1, 14.24 + 0.001 * (i + 1)),
    ),
  };
}

const RUNWAY_SURFACE: SurfaceResponse = {
  id: "surface-1",
  airport_id: "airport-1",
  identifier: "06/24",
  surface_type: "RUNWAY",
  geometry: {
    type: "LineString",
    coordinates: [
      [14.24, 50.1, 0],
      [14.27, 50.1, 0],
    ],
  },
  boundary: null,
  buffer_distance: 0,
  heading: 90,
  length: 3000,
  width: 45,
  threshold_position: { type: "Point", coordinates: [14.24, 50.1, 0] },
  end_position: { type: "Point", coordinates: [14.27, 50.1, 0] },
  touchpoint_latitude: null,
  touchpoint_longitude: null,
  touchpoint_altitude: null,
  paired_surface_id: null,
  agls: [],
};

describe("TemplateAglSection", () => {
  it("hides the mode toggle on AGLs with <= 4 LHAs (PAPI)", () => {
    const agl = makeAgl(4);
    render(
      <TemplateAglSection
        agl={agl}
        selectedLhaIds={new Set()}
        onSelectionChange={vi.fn()}
        isEditing
        onRuleChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("lha-selection-mode-toggle")).toBeNull();
  });

  it("shows the mode toggle when AGL has more than 4 LHAs", () => {
    const agl = makeAgl(6);
    render(
      <TemplateAglSection
        agl={agl}
        selectedLhaIds={new Set()}
        onSelectionChange={vi.fn()}
        isEditing
        onRuleChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("lha-selection-mode-toggle")).toBeTruthy();
  });

  it("renders a #{n} prefix on every lha row", () => {
    const agl = makeAgl(3);
    render(
      <TemplateAglSection
        agl={agl}
        selectedLhaIds={new Set()}
        onSelectionChange={vi.fn()}
        isEditing
      />,
    );
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
  });

  it("switching to ALL overwrites selection with every lha id", () => {
    const agl = makeAgl(6);
    const onSelectionChange = vi.fn();
    const onRuleChange = vi.fn();
    render(
      <TemplateAglSection
        agl={agl}
        selectedLhaIds={new Set(["lha-2"])}
        onSelectionChange={onSelectionChange}
        isEditing
        rule={{ mode: "CUSTOM" }}
        onRuleChange={onRuleChange}
      />,
    );
    fireEvent.click(screen.getByTestId("lha-selection-mode-all"));
    expect(onRuleChange).toHaveBeenCalledWith({ mode: "ALL" });
    expect(onSelectionChange).toHaveBeenCalledWith(
      new Set(agl.lhas.map((l) => l.id)),
    );
  });

  it("switching to CUSTOM does not change the working selection", () => {
    const agl = makeAgl(6);
    const onSelectionChange = vi.fn();
    const onRuleChange = vi.fn();
    render(
      <TemplateAglSection
        agl={agl}
        surface={RUNWAY_SURFACE}
        selectedLhaIds={new Set(["lha-1", "lha-2"])}
        onSelectionChange={onSelectionChange}
        isEditing
        rule={{ mode: "ALL" }}
        onRuleChange={onRuleChange}
      />,
    );
    fireEvent.click(screen.getByTestId("lha-selection-mode-custom"));
    expect(onRuleChange).toHaveBeenCalledWith({ mode: "CUSTOM" });
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("renders the section info hint with help copy", () => {
    const agl = makeAgl(2);
    render(
      <TemplateAglSection
        agl={agl}
        selectedLhaIds={new Set()}
        onSelectionChange={vi.fn()}
        isEditing
      />,
    );
    const trigger = screen.getByTestId(`hint-template-agl-section-${agl.id}`);
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "mission.config.lhaSelection.titleHelp",
    );
  });
});
