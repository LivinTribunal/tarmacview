import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PointZ } from "@/types/common";
import PositionBlock from "./PositionBlock";

const pos: PointZ = { type: "Point", coordinates: [17, 48, 200] };

describe("PositionBlock", () => {
  it("renders the id-scoped field + section testids", () => {
    render(
      <PositionBlock id="threshold" label="Threshold" position={pos} onChange={vi.fn()} centerlineWarningDist={null} />,
    );
    expect(screen.getByTestId("surface-threshold-section")).toBeInTheDocument();
    expect(document.getElementById("feat-threshold-lat")).toBeInTheDocument();
    expect(document.getElementById("feat-threshold-lon")).toBeInTheDocument();
    expect(document.getElementById("feat-threshold-alt")).toBeInTheDocument();
  });

  it("commits a valid latitude as a merged Point", () => {
    const onChange = vi.fn();
    render(
      <PositionBlock id="threshold" label="T" position={pos} onChange={onChange} centerlineWarningDist={null} />,
    );
    fireEvent.change(document.getElementById("feat-threshold-lat")!, { target: { value: "49" } });
    expect(onChange).toHaveBeenCalledWith({ type: "Point", coordinates: [17, 49, 200] });
  });

  it("rejects an out-of-bounds latitude (no onChange)", () => {
    const onChange = vi.fn();
    render(
      <PositionBlock id="threshold" label="T" position={pos} onChange={onChange} centerlineWarningDist={null} />,
    );
    fireEvent.change(document.getElementById("feat-threshold-lat")!, { target: { value: "999" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bounds longitude (no onChange)", () => {
    const onChange = vi.fn();
    render(
      <PositionBlock id="end" label="E" position={pos} onChange={onChange} centerlineWarningDist={null} />,
    );
    fireEvent.change(document.getElementById("feat-end-lon")!, { target: { value: "200" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops the outer card chrome when nested", () => {
    const { rerender } = render(
      <PositionBlock id="threshold" label="T" position={pos} onChange={vi.fn()} centerlineWarningDist={null} />,
    );
    expect(screen.getByTestId("surface-threshold-section").className).toContain("border-tv-border");
    rerender(
      <PositionBlock id="threshold" label="T" position={pos} onChange={vi.fn()} centerlineWarningDist={null} nested />,
    );
    const section = screen.getByTestId("surface-threshold-section");
    expect(section.className).not.toContain("border-tv-border");
    expect(section.className).not.toContain("rounded-lg");
  });

  it("shows the centerline warning only past 50 m", () => {
    const { rerender } = render(
      <PositionBlock id="t" label="T" position={pos} onChange={vi.fn()} centerlineWarningDist={40} />,
    );
    expect(screen.queryByText("coordinator.detail.centerlineWarning")).not.toBeInTheDocument();
    rerender(
      <PositionBlock id="t" label="T" position={pos} onChange={vi.fn()} centerlineWarningDist={75} />,
    );
    expect(screen.getByText("coordinator.detail.centerlineWarning")).toBeInTheDocument();
  });
});
