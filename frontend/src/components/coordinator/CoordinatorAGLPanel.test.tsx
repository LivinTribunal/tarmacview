import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CoordinatorAGLPanel from "./CoordinatorAGLPanel";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";

function lha(overrides: Partial<LHAResponse> = {}): LHAResponse {
  /** build a minimal lha for tests. */
  return {
    id: "lha1",
    agl_id: "agl1",
    unit_designator: "L1",
    setting_angle: 3,
    transition_sector_width: null,
    lamp_type: "INCANDESCENT",
    position: { type: "Point", coordinates: [14.5, 50.1, 0] },
    tolerance: null,
    sequence_number: 1,
    ...overrides,
  } as LHAResponse;
}

function agl(overrides: Partial<AGLResponse> = {}): AGLResponse {
  /** build a minimal agl with a single lha for tests. */
  return {
    id: "agl1",
    surface_id: "s1",
    agl_type: "PAPI",
    name: "PAPI 09L",
    position: { type: "Point", coordinates: [14.5, 50.1, 0] },
    side: "LEFT",
    glide_slope_angle: 3,
    distance_from_threshold: 300,
    offset_from_centerline: 15,
    lhas: [lha({ id: "lha-a", agl_id: "agl1" })],
    ...overrides,
  } as AGLResponse;
}

function surface(agls: AGLResponse[] = [agl()]): SurfaceResponse {
  /** build a minimal surface with provided agls. */
  return {
    id: "s1",
    airport_id: "a1",
    identifier: "09L/27R",
    surface_type: "RUNWAY",
    geometry: { type: "LineString", coordinates: [] },
    boundary: null,
    buffer_distance: 0,
    heading: 90,
    length: 3000,
    width: 45,
    threshold_position: null,
    end_position: null,
    touchpoint_latitude: null,
    touchpoint_longitude: null,
    touchpoint_altitude: null,
    paired_surface_id: null,
    agls,
  } as SurfaceResponse;
}

describe("CoordinatorAGLPanel click behavior", () => {
  it("single-click on agl row calls onSelect and expands the row", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    const row = screen.getByTestId("coordinator-agl-item-agl-x");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ type: "agl", data: a });
    expect(onLocate).not.toHaveBeenCalled();
    expect(screen.getByTestId(`coordinator-lha-item-${a.lhas[0].id}`)).toBeInTheDocument();
  });

  it("double-click on agl row calls onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    const row = screen.getByTestId("coordinator-agl-item-agl-x");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledWith({ type: "agl", data: a });
  });

  it("skips the second click of a double-click so the accordion stays expanded", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    const row = screen.getByTestId("coordinator-agl-item-agl-x");
    // browser fires two click events before dblclick; the second (detail === 2)
    // must not toggle expansion back closed and must not call onSelect again
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith({ type: "agl", data: a });
    expect(screen.getByTestId(`coordinator-lha-item-${a.lhas[0].id}`)).toBeInTheDocument();
  });

  it("single-click on lha row calls onSelect with the lha feature", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("coordinator-agl-item-agl-x"));
    onSelect.mockClear();

    fireEvent.click(screen.getByTestId("coordinator-lha-item-lha-y"));

    expect(onSelect).toHaveBeenCalledWith({ type: "lha", data: l });
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click on lha row calls onLocate with the lha feature", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("coordinator-agl-item-agl-x"));
    fireEvent.doubleClick(screen.getByTestId("coordinator-lha-item-lha-y"));

    expect(onLocate).toHaveBeenCalledWith({ type: "lha", data: l });
  });

  it("renders LHAs sorted by sequence_number with #n prefix", () => {
    const a = agl({
      id: "agl-x",
      lhas: [
        lha({ id: "lha-c", agl_id: "agl-x", unit_designator: "C", sequence_number: 3 }),
        lha({ id: "lha-a", agl_id: "agl-x", unit_designator: "A", sequence_number: 1 }),
        lha({ id: "lha-b", agl_id: "agl-x", unit_designator: "B", sequence_number: 2 }),
      ],
    });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={vi.fn()}
        onLocate={vi.fn()}
        onDeleteAgl={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("coordinator-agl-item-agl-x"));

    const items = screen.getAllByTestId(/^coordinator-lha-item-/);
    // visual order matches sequence_number, not insertion order
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "coordinator-lha-item-lha-a",
      "coordinator-lha-item-lha-b",
      "coordinator-lha-item-lha-c",
    ]);
    // each row carries its #n prefix
    expect(items[0].textContent).toContain("#1");
    expect(items[1].textContent).toContain("#2");
    expect(items[2].textContent).toContain("#3");
  });

  it("skips the second click of a double-click on an lha row", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={onLocate}
        onDeleteAgl={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("coordinator-agl-item-agl-x"));
    onSelect.mockClear();

    const lhaRow = screen.getByTestId("coordinator-lha-item-lha-y");
    fireEvent.click(lhaRow, { detail: 1 });
    fireEvent.click(lhaRow, { detail: 2 });
    fireEvent.doubleClick(lhaRow);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith({ type: "lha", data: l });
  });

  it("activates the lha row via keyboard without a nested-button violation", () => {
    const onSelect = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <CoordinatorAGLPanel
        surfaces={[surface([a])]}
        onSelect={onSelect}
        onLocate={vi.fn()}
        onDeleteAgl={vi.fn()}
        onDeleteLha={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("coordinator-agl-item-agl-x"));
    onSelect.mockClear();

    const lhaRow = screen.getByTestId("coordinator-lha-item-lha-y");
    expect(lhaRow).toHaveAttribute("role", "button");
    expect(lhaRow.tagName).toBe("DIV");
    fireEvent.keyDown(lhaRow, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith({ type: "lha", data: l });
  });

  it("renders the AGL systems info hint with help copy", () => {
    render(
      <CoordinatorAGLPanel
        surfaces={[surface()]}
        onSelect={vi.fn()}
        onDeleteAgl={vi.fn()}
      />,
    );
    const trigger = screen.getByTestId("hint-coordinator-agl-systems");
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("airport.aglSystemsHelp");
  });
});
