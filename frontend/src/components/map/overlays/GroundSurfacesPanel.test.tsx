import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GroundSurfacesPanel from "./GroundSurfacesPanel";
import type { SurfaceResponse } from "@/types/airport";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";

function surface(overrides: Partial<SurfaceResponse> = {}): SurfaceResponse {
  /** build a minimal runway surface for tests. */
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
    elevation: 0,
    paired_surface_id: null,
    agls: [],
    ...overrides,
  } as SurfaceResponse;
}

describe("GroundSurfacesPanel click behavior", () => {
  it("single-click calls onSelect only, not onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const s = surface({ id: "s-x" });
    render(
      <GroundSurfacesPanel
        surfaces={[s]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("surface-item-s-x");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith({ type: "surface", data: s });
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click calls onLocate with the surface feature", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const s = surface({ id: "s-x" });
    render(
      <GroundSurfacesPanel
        surfaces={[s]}
        layerConfig={DEFAULT_LAYER_CONFIG}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("surface-item-s-x");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledWith({ type: "surface", data: s });
  });

  it("does not call onLocate when the surface row is grayed out", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    const s = surface({ id: "s-x", surface_type: "RUNWAY" });
    render(
      <GroundSurfacesPanel
        surfaces={[s]}
        layerConfig={{ ...DEFAULT_LAYER_CONFIG, runways: false }}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("surface-item-s-x");
    fireEvent.doubleClick(row);

    expect(onLocate).not.toHaveBeenCalled();
  });
});
