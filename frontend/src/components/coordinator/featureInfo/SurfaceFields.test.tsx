import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SurfaceResponse } from "@/types/airport";
import SurfaceFields from "./SurfaceFields";

const surface = { id: "s-1", surface_type: "RUNWAY" } as unknown as SurfaceResponse;

function renderFields(values: Record<string, string>, over: Record<string, unknown> = {}) {
  const handleChange = vi.fn();
  const onUpdate = vi.fn();
  const val = (k: string) => values[k] ?? "";
  render(
    <SurfaceFields
      data={{ geometry: { type: "LineString", coordinates: [[0, 0, 0], [0.01, 0, 0]] } }}
      surface={surface}
      val={val}
      handleChange={handleChange}
      onUpdate={onUpdate}
      recalcLoading={false}
      recalcError={null}
      recalcPreview={null}
      onRecalculate={vi.fn()}
      onApplyRecalculate={vi.fn()}
      onCancelRecalculate={vi.fn()}
      {...over}
    />,
  );
  return { handleChange, onUpdate };
}

describe("SurfaceFields orchestrator", () => {
  it("renders the core surface fields and the runway sub-sections", () => {
    renderFields({ surface_type: "RUNWAY" });
    expect(document.getElementById("feat-identifier")).toBeInTheDocument();
    expect(document.getElementById("feat-heading")).toBeInTheDocument();
    expect(document.getElementById("feat-length")).toBeInTheDocument();
    expect(document.getElementById("feat-width")).toBeInTheDocument();
    expect(document.getElementById("feat-surface-buffer")).toBeInTheDocument();
    expect(screen.getByTestId("surface-touchpoint-section")).toBeInTheDocument();
    expect(screen.getByTestId("surface-threshold-section")).toBeInTheDocument();
    expect(screen.getByTestId("surface-end-position-section")).toBeInTheDocument();
  });

  it("hides the runway-only sections for taxiways", () => {
    renderFields({ surface_type: "TAXIWAY" });
    expect(screen.queryByTestId("surface-touchpoint-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("surface-threshold-section")).not.toBeInTheDocument();
  });

  it("shows the heading field with compass and flip for taxiways", () => {
    const { handleChange } = renderFields({ surface_type: "TAXIWAY", heading: "135" });
    expect(document.getElementById("feat-heading")).toBeInTheDocument();
    fireEvent.click(screen.getByText("coordinator.detail.opposite"));
    expect(handleChange).toHaveBeenCalledWith("heading", 315);
  });

  it("forwards identifier edits through handleChange unchanged", () => {
    const { handleChange } = renderFields({ surface_type: "RUNWAY", identifier: "09" });
    fireEvent.change(document.getElementById("feat-identifier")!, { target: { value: "27" } });
    expect(handleChange).toHaveBeenCalledWith("identifier", "27");
  });

  it("parses a numeric heading to a float", () => {
    const { handleChange } = renderFields({ surface_type: "RUNWAY" });
    fireEvent.change(document.getElementById("feat-heading")!, { target: { value: "88.5" } });
    expect(handleChange).toHaveBeenCalledWith("heading", 88.5);
  });

  it("maps a cleared heading to null", () => {
    const { handleChange } = renderFields({ surface_type: "RUNWAY", heading: "90" });
    fireEvent.change(document.getElementById("feat-heading")!, { target: { value: "" } });
    expect(handleChange).toHaveBeenCalledWith("heading", null);
  });
});
