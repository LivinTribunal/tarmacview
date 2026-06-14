import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AGLPanel from "./AGLPanel";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";

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

describe("AGLPanel click behavior", () => {
  it("single-click on agl row calls onSelect and expands the row", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("agl-item-agl-x");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ type: "agl", data: a });
    expect(onLocate).not.toHaveBeenCalled();
    // expanded row reveals the lha sub-item
    expect(screen.getByTestId(`lha-item-${a.lhas[0].id}`)).toBeInTheDocument();
  });

  it("double-click on agl row calls onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("agl-item-agl-x");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledWith({ type: "agl", data: a });
  });

  it("skips the second click of a double-click so the accordion stays expanded", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("agl-item-agl-x");
    // browser fires two click events before dblclick; the second (detail === 2)
    // must not toggle expansion back closed and must not call onSelect again
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith({ type: "agl", data: a });
    // row remains expanded after the double-click
    expect(screen.getByTestId(`lha-item-${a.lhas[0].id}`)).toBeInTheDocument();
  });

  it("single-click on lha row calls onSelect with the lha feature", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    // expand the agl first to reveal the lha row
    fireEvent.click(screen.getByTestId("agl-item-agl-x"));
    onSelect.mockClear();

    const lhaRow = screen.getByTestId("lha-item-lha-y");
    fireEvent.click(lhaRow);

    expect(onSelect).toHaveBeenCalledWith({ type: "lha", data: l });
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click on lha row calls onLocate with the lha feature", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    fireEvent.click(screen.getByTestId("agl-item-agl-x"));
    fireEvent.doubleClick(screen.getByTestId("lha-item-lha-y"));

    expect(onLocate).toHaveBeenCalledWith({ type: "lha", data: l });
  });

  it("skips the second click of a double-click on an lha row", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const l = lha({ id: "lha-y", agl_id: "agl-x" });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    fireEvent.click(screen.getByTestId("agl-item-agl-x"));
    onSelect.mockClear();

    const lhaRow = screen.getByTestId("lha-item-lha-y");
    fireEvent.click(lhaRow, { detail: 1 });
    fireEvent.click(lhaRow, { detail: 2 });
    fireEvent.doubleClick(lhaRow);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith({ type: "lha", data: l });
  });

  it("does not invoke handlers when layer is grayed out", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const a = agl({ id: "agl-x" });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={{ ...DEFAULT_LAYER_CONFIG, aglSystems: false }}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("agl-item-agl-x");
    fireEvent.click(row);
    fireEvent.doubleClick(row);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onLocate).not.toHaveBeenCalled();
  });
});

describe("AGLPanel LHA coordinates", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("renders LHA position at 8 decimals and copies the raw value", () => {
    const l = lha({
      id: "lha-c",
      agl_id: "agl-x",
      position: { type: "Point", coordinates: [14.123456789, 50.987654321, 0] },
    });
    const a = agl({ id: "agl-x", lhas: [l] });

    render(
      <AGLPanel
        surfaces={[surface([a])]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={vi.fn()}
        onLocate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("agl-item-agl-x"));
    const row = screen.getByTestId("lha-item-lha-c");
    expect(row).toHaveTextContent("50.98765432, 14.12345679");

    const [latCopy, lonCopy] = within(row).getAllByTestId("copyable-value");
    fireEvent.click(latCopy);
    expect(writeText).toHaveBeenCalledWith("50.98765432");
    fireEvent.click(lonCopy);
    expect(writeText).toHaveBeenCalledWith("14.12345679");
  });
});
