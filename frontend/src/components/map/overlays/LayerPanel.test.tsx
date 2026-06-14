import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LayerPanel from "./LayerPanel";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";

describe("LayerPanel safety-zone / airport-boundary split", () => {
  it("renders both rows and forwards the correct toggle keys", () => {
    const onToggle = vi.fn();
    render(<LayerPanel layers={DEFAULT_LAYER_CONFIG} onToggle={onToggle} />);

    const safetyZonesLabel = screen.getByText("layers.safetyZones");
    const boundaryLabel = screen.getByText("layers.airportBoundary");
    expect(safetyZonesLabel).toBeInTheDocument();
    expect(boundaryLabel).toBeInTheDocument();

    const safetyToggle = safetyZonesLabel.parentElement!.querySelector("button[role='switch']");
    const boundaryToggle = boundaryLabel.parentElement!.querySelector("button[role='switch']");
    expect(safetyToggle).toBeTruthy();
    expect(boundaryToggle).toBeTruthy();

    fireEvent.click(safetyToggle!);
    expect(onToggle).toHaveBeenLastCalledWith("safetyZones");

    fireEvent.click(boundaryToggle!);
    expect(onToggle).toHaveBeenLastCalledWith("airportBoundary");
  });
});
