import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SurfaceTouchpointSection from "./SurfaceTouchpointSection";

describe("SurfaceTouchpointSection", () => {
  it("renders the touchpoint field ids + section testid", () => {
    render(<SurfaceTouchpointSection val={() => ""} handleChange={vi.fn()} />);
    expect(screen.getByTestId("surface-touchpoint-section")).toBeInTheDocument();
    expect(document.getElementById("feat-tp-lat")).toBeInTheDocument();
    expect(document.getElementById("feat-tp-lon")).toBeInTheDocument();
    expect(document.getElementById("feat-tp-alt")).toBeInTheDocument();
  });

  it("parses numeric input to a float", () => {
    const handleChange = vi.fn();
    render(<SurfaceTouchpointSection val={() => ""} handleChange={handleChange} />);
    fireEvent.change(document.getElementById("feat-tp-lat")!, { target: { value: "48.1" } });
    expect(handleChange).toHaveBeenCalledWith("touchpoint_latitude", 48.1);
  });

  it("maps a cleared field to null", () => {
    const handleChange = vi.fn();
    render(<SurfaceTouchpointSection val={(k) => (k === "touchpoint_altitude" ? "12" : "")} handleChange={handleChange} />);
    fireEvent.change(document.getElementById("feat-tp-alt")!, { target: { value: "" } });
    expect(handleChange).toHaveBeenCalledWith("touchpoint_altitude", null);
  });

  it("renders the pick-on-map button only when the toggle is supplied", () => {
    const { rerender } = render(
      <SurfaceTouchpointSection val={() => ""} handleChange={vi.fn()} />,
    );
    expect(screen.queryByTestId("surface-touchpoint-pick-map")).not.toBeInTheDocument();
    rerender(
      <SurfaceTouchpointSection val={() => ""} handleChange={vi.fn()} onPickTouchpointToggle={vi.fn()} />,
    );
    expect(screen.getByTestId("surface-touchpoint-pick-map")).toBeInTheDocument();
  });
});
