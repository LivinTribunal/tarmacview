import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EditableFeatureInfo from "./EditableFeatureInfo";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import type { MapFeature, MapFeatureLHA } from "@/types/map";

vi.mock("@/api/airports", () => ({
  bulkCreateLHAs: vi.fn(),
  recalculateSurface: vi.fn(),
  recalculateObstacle: vi.fn(),
}));

function makeLha(overrides: Partial<LHAResponse> = {}): LHAResponse {
  /** build a minimal LHA fixture for tests. */
  return {
    id: "lha-1",
    agl_id: "agl-1",
    unit_designator: "1",
    setting_angle: 3,
    transition_sector_width: null,
    lamp_type: "HALOGEN",
    position: { type: "Point", coordinates: [14.5, 50.1, 380] },
    tolerance: 0.2,
    sequence_number: 2,
    lens_height_msl_m: null,
    lens_height_agl_m: null,
    ...overrides,
  };
}

function lhaFeature(data: LHAResponse): MapFeatureLHA {
  /** wrap an lha as a MapFeature. */
  return { type: "lha", data };
}

function makeSurfaceWithAgl(lhas: LHAResponse[]): SurfaceResponse {
  /** build a runway-edge-lights AGL containing the given LHAs. */
  const agl: AGLResponse = {
    id: "agl-1",
    surface_id: "surf-1",
    agl_type: "RUNWAY_EDGE_LIGHTS",
    name: "edge",
    position: { type: "Point", coordinates: [14.5, 50.1, 380] },
    side: null,
    glide_slope_angle: null,
    glide_slope_angle_tolerance: null,
    ils_harmonization_tolerance: null,
    distance_from_threshold: null,
    meht_height_m: null,
    offset_from_centerline: null,
    lhas,
  };
  return {
    id: "surf-1",
    airport_id: "apt-1",
    identifier: "06/24",
    surface_type: "RUNWAY",
    geometry: { type: "LineString", coordinates: [] },
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
    agls: [agl],
  };
}

describe("EditableFeatureInfo - pending patch overlay", () => {
  it("seeds the input with a pending patch when the feature switches", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    const lhaB = makeLha({ id: "lha-b", setting_angle: 5 });

    const { rerender } = render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaB)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("5");

    // switch to lha-a which has a pending edit; the input should reflect the staged value
    rerender(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        pendingPatch={{ setting_angle: 4.2 }}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("4.2");
  });

  it("falls back to the server value when no pending patch is present", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    const lhaB = makeLha({ id: "lha-b", setting_angle: 7 });

    const { rerender } = render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("3");

    rerender(
      <EditableFeatureInfo
        feature={lhaFeature(lhaB)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("7");
  });

  it("displays the latest pendingPatch on every render and pushes onUpdate per keystroke", () => {
    const featureRef = lhaFeature(makeLha({ id: "lha-a", setting_angle: 3 }));
    const onUpdate = vi.fn();
    const { rerender } = render(
      <EditableFeatureInfo
        feature={featureRef}
        onUpdate={onUpdate}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "4.5" } });
    expect(onUpdate).toHaveBeenCalledWith({ setting_angle: 4.5 });

    // parent re-renders with a different staged value (e.g. an undo/redo step
    // produced a new patch); the controlled value must reflect it
    rerender(
      <EditableFeatureInfo
        feature={featureRef}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        pendingPatch={{ setting_angle: 9.9 }}
      />,
    );
    expect(input.value).toBe("9.9");
  });

  it("works without a pendingPatch prop (regression guard)", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("3");
  });
});

describe("EditableFeatureInfo - undo/redo while panel is open", () => {
  it("undo updates the displayed value back to the server value", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    const { rerender } = render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        pendingPatch={{ setting_angle: 4.2 }}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("4.2");

    // simulate undo: parent's pending change clears for this entity
    rerender(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("3");
  });

  it("redo re-applies the staged value", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    const { rerender } = render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("3");

    rerender(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        pendingPatch={{ setting_angle: 4.2 }}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("4.2");
  });

  it("post-save (clearAll) keeps showing the value once it's reflected on the server record", () => {
    const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
    const { rerender } = render(
      <EditableFeatureInfo
        feature={lhaFeature(lhaA)}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        pendingPatch={{ setting_angle: 4.2 }}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("4.2");

    // server fetch returns the saved record; pending patch cleared
    rerender(
      <EditableFeatureInfo
        feature={lhaFeature(makeLha({ id: "lha-a", setting_angle: 4.2 }))}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement).value).toBe("4.2");
  });

  it("typing flows child->parent->child without remounting the input", () => {
    function Harness() {
      const lhaA = makeLha({ id: "lha-a", setting_angle: 3 });
      const [patch, setPatch] = useState<Record<string, unknown> | undefined>(undefined);
      return (
        <EditableFeatureInfo
          feature={lhaFeature(lhaA)}
          onUpdate={(u) => setPatch((prev) => ({ ...prev, ...u }))}
          onClose={vi.fn()}
          pendingPatch={patch}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" }) as HTMLInputElement;
    const before = input;
    fireEvent.change(input, { target: { value: "4.5" } });
    expect(input.value).toBe("4.5");
    // the same input node is still in the DOM (no remount)
    expect(screen.getByLabelText("coordinator.detail.lhaSettingAngle", { selector: "input" })).toBe(before);
  });
});

describe("EditableFeatureInfo - LHA sequence number", () => {
  it("renders the current sequence number in a numeric input", () => {
    const lha = makeLha({ sequence_number: 2 });
    const surface = makeSurfaceWithAgl([
      makeLha({ id: "l1", sequence_number: 1 }),
      lha,
      makeLha({ id: "l3", sequence_number: 3 }),
    ]);
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const input = screen.getByTestId("feat-sequence-number") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("2");
    expect(input.min).toBe("1");
    expect(input.max).toBe("3");
  });

  it("calls onUpdate({ sequence_number }) when the user types a new in-range value", () => {
    const lha = makeLha({ sequence_number: 2 });
    const surface = makeSurfaceWithAgl([
      makeLha({ id: "l1", sequence_number: 1 }),
      lha,
      makeLha({ id: "l3", sequence_number: 3 }),
    ]);
    const onUpdate = vi.fn();
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const input = screen.getByTestId("feat-sequence-number");
    fireEvent.change(input, { target: { value: "1" } });

    expect(onUpdate).toHaveBeenCalledWith({ sequence_number: 1 });
  });

  it("does not call onUpdate when the user types a value outside [1, count]", () => {
    const lha = makeLha({ sequence_number: 2 });
    const surface = makeSurfaceWithAgl([
      makeLha({ id: "l1", sequence_number: 1 }),
      lha,
      makeLha({ id: "l3", sequence_number: 3 }),
    ]);
    const onUpdate = vi.fn();
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const input = screen.getByTestId("feat-sequence-number");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "99" } });

    // out-of-range values stay local; only valid values reach onUpdate
    const seqUpdates = onUpdate.mock.calls.filter(
      (c) => Object.prototype.hasOwnProperty.call(c[0], "sequence_number"),
    );
    expect(seqUpdates).toEqual([]);
  });
});

function makePapiSurface(lhas: LHAResponse[]): SurfaceResponse {
  /** build a runway with a PAPI AGL containing the given LHAs. */
  const agl: AGLResponse = {
    id: "agl-papi",
    surface_id: "surf-1",
    agl_type: "PAPI",
    name: "papi-left",
    position: { type: "Point", coordinates: [14.5, 50.1, 380] },
    side: "LEFT",
    glide_slope_angle: 3,
    glide_slope_angle_tolerance: null,
    ils_harmonization_tolerance: null,
    distance_from_threshold: 300,
    meht_height_m: null,
    offset_from_centerline: 15,
    lhas,
  };
  return {
    id: "surf-1",
    airport_id: "apt-1",
    identifier: "06/24",
    surface_type: "RUNWAY",
    geometry: { type: "LineString", coordinates: [] },
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
    agls: [agl],
  };
}

describe("EditableFeatureInfo - PAPI unit designator", () => {
  it("hides the sequence_number input on PAPI LHAs (the letter dropdown is the equivalent control)", () => {
    const lha = makeLha({ id: "p2", agl_id: "agl-papi", unit_designator: "B", sequence_number: 2 });
    const surface = makePapiSurface([
      makeLha({ id: "p1", agl_id: "agl-papi", unit_designator: "A", sequence_number: 1 }),
      lha,
      makeLha({ id: "p3", agl_id: "agl-papi", unit_designator: "C", sequence_number: 3 }),
      makeLha({ id: "p4", agl_id: "agl-papi", unit_designator: "D", sequence_number: 4 }),
    ]);
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    expect(screen.queryByTestId("feat-sequence-number")).not.toBeInTheDocument();
  });

  it("shows all four letters in the PAPI dropdown regardless of sibling occupancy", () => {
    const lha = makeLha({ id: "p2", agl_id: "agl-papi", unit_designator: "B", sequence_number: 2 });
    const surface = makePapiSurface([
      makeLha({ id: "p1", agl_id: "agl-papi", unit_designator: "A", sequence_number: 1 }),
      lha,
      makeLha({ id: "p3", agl_id: "agl-papi", unit_designator: "C", sequence_number: 3 }),
      makeLha({ id: "p4", agl_id: "agl-papi", unit_designator: "D", sequence_number: 4 }),
    ]);
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const select = screen.getByTestId("feat-unit-designator") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["A", "B", "C", "D"]);
  });

  it("submits a sequence_number change when the user picks a different letter", () => {
    const lha = makeLha({ id: "p2", agl_id: "agl-papi", unit_designator: "B", sequence_number: 2 });
    const surface = makePapiSurface([
      makeLha({ id: "p1", agl_id: "agl-papi", unit_designator: "A", sequence_number: 1 }),
      lha,
      makeLha({ id: "p3", agl_id: "agl-papi", unit_designator: "C", sequence_number: 3 }),
      makeLha({ id: "p4", agl_id: "agl-papi", unit_designator: "D", sequence_number: 4 }),
    ]);
    const onUpdate = vi.fn();
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const select = screen.getByTestId("feat-unit-designator");
    fireEvent.change(select, { target: { value: "D" } });

    expect(onUpdate).toHaveBeenCalledWith({ sequence_number: 4 });
    // does not bypass the seq-number path by writing the letter directly
    const letterUpdates = onUpdate.mock.calls.filter(
      (c) => Object.prototype.hasOwnProperty.call(c[0], "unit_designator"),
    );
    expect(letterUpdates).toEqual([]);
  });

  it("derives the displayed letter from sequence_number so it tracks staged edits", () => {
    // sequence_number=3 should render as 'C' even if unit_designator on the
    // record is stale (server hasn't relabeled yet, or data has a pending
    // sequence patch but no letter patch)
    const lha = makeLha({
      id: "p3",
      agl_id: "agl-papi",
      unit_designator: "A",
      sequence_number: 3,
    });
    const surface = makePapiSurface([
      makeLha({ id: "p1", agl_id: "agl-papi", unit_designator: "A", sequence_number: 1 }),
      makeLha({ id: "p2", agl_id: "agl-papi", unit_designator: "B", sequence_number: 2 }),
      lha,
    ]);
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const select = screen.getByTestId("feat-unit-designator") as HTMLSelectElement;
    expect(select.value).toBe("C");
  });

  it("shows lens-height inputs for PAPI LHAs and edits flow through onUpdate", () => {
    const lha = makeLha({
      id: "p1",
      agl_id: "agl-papi",
      unit_designator: "A",
      sequence_number: 1,
      lens_height_msl_m: 380.5,
      lens_height_agl_m: 10.25,
    });
    const surface = makePapiSurface([lha]);
    const onUpdate = vi.fn();
    const feature: MapFeature = { type: "lha", data: lha };

    render(
      <EditableFeatureInfo
        feature={feature}
        onUpdate={onUpdate}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );

    const msl = screen.getByTestId("feat-lens-msl") as HTMLInputElement;
    const agl = screen.getByTestId("feat-lens-agl") as HTMLInputElement;
    expect(msl.value).toBe("380.5");
    expect(agl.value).toBe("10.25");

    fireEvent.change(msl, { target: { value: "390.75" } });
    expect(onUpdate).toHaveBeenCalledWith({ lens_height_msl_m: 390.75 });

    fireEvent.change(agl, { target: { value: "" } });
    expect(onUpdate).toHaveBeenCalledWith({ lens_height_agl_m: null });
  });

  it("hides lens-height inputs for non-PAPI LHAs", () => {
    const surface = makeSurfaceWithAgl([makeLha()]);
    render(
      <EditableFeatureInfo
        feature={lhaFeature(makeLha())}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );
    expect(screen.queryByTestId("feat-lens-msl")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feat-lens-agl")).not.toBeInTheDocument();
  });
});

describe("EditableFeatureInfo info hints", () => {
  it("renders the lha unit-designator hint with help copy", () => {
    const surface = makeSurfaceWithAgl([makeLha()]);
    render(
      <EditableFeatureInfo
        feature={lhaFeature(makeLha())}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        surfaces={[surface]}
      />,
    );
    const trigger = screen.getByTestId("hint-feat-lha-unit-designator");
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "coordinator.detail.lhaUnitDesignatorHelp",
    );
  });
});
