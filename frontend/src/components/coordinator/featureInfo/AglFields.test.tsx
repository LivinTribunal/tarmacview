import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditableFeatureInfo from "../EditableFeatureInfo";
import type { SurfaceResponse, AGLResponse, LHAResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";

vi.mock("@/api/airports", () => ({
  reverseLHAs: vi.fn(),
  bulkCreateLHAs: vi.fn(),
  recalculateSurface: vi.fn(),
  recalculateObstacle: vi.fn(),
}));

import { reverseLHAs } from "@/api/airports";

function makeLha(seq: number, designator: string): LHAResponse {
  return {
    id: `lha-${seq}`,
    agl_id: "agl-1",
    unit_designator: designator,
    setting_angle: 3.0,
    transition_sector_width: null,
    lamp_type: "HALOGEN",
    position: { type: "Point", coordinates: [17.0, 48.0, 133] },
    tolerance: 0.2,
    sequence_number: seq,
    lens_height_msl_m: null,
    lens_height_agl_m: null,
  };
}

function makeAgl(overrides: Partial<AGLResponse> = {}): AGLResponse {
  return {
    id: "agl-1",
    surface_id: "surf-1",
    agl_type: "PAPI",
    name: "PAPI RWY 06/24",
    position: { type: "Point", coordinates: [17.0, 48.0, 133] },
    side: "LEFT",
    glide_slope_angle: 3.0,
    glide_slope_angle_tolerance: 0.1,
    ils_harmonization_tolerance: null,
    distance_from_threshold: null,
    meht_height_m: null,
    offset_from_centerline: null,
    lhas: [makeLha(1, "A"), makeLha(2, "B"), makeLha(3, "C"), makeLha(4, "D")],
    ...overrides,
  };
}

const surface: SurfaceResponse = {
  id: "surf-1",
  airport_id: "apt-1",
  identifier: "06/24",
  surface_type: "RUNWAY",
  geometry: { type: "LineString", coordinates: [[17.0, 48.0, 133], [17.02, 48.0, 133]] },
  boundary: null,
  buffer_distance: 5,
  heading: 90,
  length: 3000,
  width: 45,
  threshold_position: null,
  end_position: null,
  touchpoint_latitude: null,
  touchpoint_longitude: null,
  touchpoint_altitude: null,
  paired_surface_id: null,
  agls: [],
};

function renderAgl(
  agl: AGLResponse,
  onLhasGenerated?: () => Promise<void> | void,
  onUpdate: (data: Record<string, unknown>) => void = () => {},
) {
  const feature: MapFeature = { type: "agl", data: agl };
  return render(
    <EditableFeatureInfo
      feature={feature}
      onUpdate={onUpdate}
      onClose={() => {}}
      airportId="apt-1"
      surfaces={[{ ...surface, agls: [agl] }]}
      onLhasGenerated={onLhasGenerated}
    />,
  );
}

describe("AglFields reverse numbering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the reverse button for a PAPI agl with >= 2 lights", () => {
    renderAgl(makeAgl());
    expect(screen.getByTestId("reverse-lhas-button")).toBeInTheDocument();
  });

  it("hides the reverse button for a PAPI agl with fewer than 2 lights", () => {
    renderAgl(makeAgl({ lhas: [makeLha(1, "A")] }));
    expect(screen.queryByTestId("reverse-lhas-button")).not.toBeInTheDocument();
  });

  it("hides the reverse button for a non-PAPI agl", () => {
    renderAgl(makeAgl({ agl_type: "RUNWAY_EDGE_LIGHTS" }));
    expect(screen.queryByTestId("reverse-lhas-button")).not.toBeInTheDocument();
  });

  it("calls reverseLHAs and refetches on click", async () => {
    const mockReverse = reverseLHAs as unknown as ReturnType<typeof vi.fn>;
    mockReverse.mockResolvedValue({ data: [], meta: { total: 4 } });
    const onLhasGenerated = vi.fn().mockResolvedValue(undefined);

    renderAgl(makeAgl(), onLhasGenerated);
    fireEvent.click(screen.getByTestId("reverse-lhas-button"));

    await waitFor(() => {
      expect(mockReverse).toHaveBeenCalledWith("apt-1", "surf-1", "agl-1");
    });
    await waitFor(() => {
      expect(onLhasGenerated).toHaveBeenCalled();
    });
  });
});

describe("AglFields glide slope tolerance", () => {
  it("renders the glide-slope tolerance input for a PAPI agl", () => {
    const { container } = renderAgl(makeAgl());
    const input = container.querySelector("#feat-glide-tolerance") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe("0.1");
  });

  it("hides the glide-slope tolerance input for a non-PAPI agl", () => {
    const { container } = renderAgl(makeAgl({ agl_type: "RUNWAY_EDGE_LIGHTS" }));
    expect(container.querySelector("#feat-glide-tolerance")).toBeNull();
  });
});

describe("AglFields ILS harmonization tolerance", () => {
  it("renders the ils-tolerance input for a PAPI agl with its value", () => {
    const { container } = renderAgl(makeAgl({ ils_harmonization_tolerance: 0.05 }));
    const input = container.querySelector("#feat-ils-tolerance") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe("0.05");
  });

  it("hides the ils-tolerance input for a non-PAPI agl", () => {
    const { container } = renderAgl(makeAgl({ agl_type: "RUNWAY_EDGE_LIGHTS" }));
    expect(container.querySelector("#feat-ils-tolerance")).toBeNull();
  });

  it("emits an ils_harmonization_tolerance update on change", () => {
    const onUpdate = vi.fn();
    const { container } = renderAgl(makeAgl(), undefined, onUpdate);
    const input = container.querySelector("#feat-ils-tolerance") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.03" } });
    expect(onUpdate).toHaveBeenCalledWith({ ils_harmonization_tolerance: 0.03 });
  });

  it("nulls out ils_harmonization_tolerance when switching to RUNWAY_EDGE_LIGHTS", () => {
    const onUpdate = vi.fn();
    renderAgl(makeAgl({ ils_harmonization_tolerance: 0.05 }), undefined, onUpdate);
    fireEvent.change(screen.getByTestId("feat-agl-type-select"), {
      target: { value: "RUNWAY_EDGE_LIGHTS" },
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        agl_type: "RUNWAY_EDGE_LIGHTS",
        ils_harmonization_tolerance: null,
      }),
    );
  });
});

describe("AglFields surveyed MEHT height", () => {
  it("renders the MEHT-height input for a PAPI agl with its surveyed value", () => {
    const { container } = renderAgl(makeAgl({ meht_height_m: 16.4 }));
    const input = container.querySelector("#feat-meht-height") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe("16.4");
  });

  it("hides the MEHT-height input for a non-PAPI agl", () => {
    const { container } = renderAgl(makeAgl({ agl_type: "RUNWAY_EDGE_LIGHTS" }));
    expect(container.querySelector("#feat-meht-height")).toBeNull();
  });

  it("emits a meht_height_m update on change", () => {
    const onUpdate = vi.fn();
    const { container } = renderAgl(makeAgl(), undefined, onUpdate);
    const input = container.querySelector("#feat-meht-height") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "18.2" } });
    expect(onUpdate).toHaveBeenCalledWith({ meht_height_m: 18.2 });
  });

  it("nulls out meht_height_m when switching to RUNWAY_EDGE_LIGHTS", () => {
    const onUpdate = vi.fn();
    renderAgl(makeAgl({ meht_height_m: 16.0 }), undefined, onUpdate);
    fireEvent.change(screen.getByTestId("feat-agl-type-select"), {
      target: { value: "RUNWAY_EDGE_LIGHTS" },
    });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ agl_type: "RUNWAY_EDGE_LIGHTS", meht_height_m: null }),
    );
  });
});
