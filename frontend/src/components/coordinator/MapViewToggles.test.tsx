import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MapViewToggles from "./MapViewToggles";

function renderToggles(
  overrides: Partial<React.ComponentProps<typeof MapViewToggles>> = {},
) {
  /** render with safe defaults; t is a passthrough. */
  const props = {
    t: (k: string) => k,
    is3D: false,
    onSet3D: vi.fn(),
    terrainMode: "satellite" as const,
    onSetTerrainMode: vi.fn(),
    ...overrides,
  };
  return { ...render(<MapViewToggles {...props} />), props };
}

describe("MapViewToggles", () => {
  it("marks the 2D and satellite toggles active by default", () => {
    renderToggles();
    expect(screen.getByTestId("toggle-2d")).toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-3d")).not.toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-satellite")).toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-map")).not.toHaveClass("bg-tv-accent");
  });

  it("marks the 3D and map toggles active when those modes are set", () => {
    renderToggles({ is3D: true, terrainMode: "map" });
    expect(screen.getByTestId("toggle-3d")).toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-2d")).not.toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-map")).toHaveClass("bg-tv-accent");
    expect(screen.getByTestId("toggle-satellite")).not.toHaveClass("bg-tv-accent");
  });

  it("dispatches the matching setter on click", () => {
    const { props } = renderToggles();
    fireEvent.click(screen.getByTestId("toggle-3d"));
    expect(props.onSet3D).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByTestId("toggle-2d"));
    expect(props.onSet3D).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId("toggle-map"));
    expect(props.onSetTerrainMode).toHaveBeenCalledWith("map");
    fireEvent.click(screen.getByTestId("toggle-satellite"));
    expect(props.onSetTerrainMode).toHaveBeenCalledWith("satellite");
  });
});
