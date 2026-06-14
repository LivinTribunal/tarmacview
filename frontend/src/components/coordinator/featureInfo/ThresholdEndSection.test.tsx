import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { PointZ } from "@/types/common";
import ThresholdEndSection from "./ThresholdEndSection";

const thr: PointZ = { type: "Point", coordinates: [17, 48, 200] };
const end: PointZ = { type: "Point", coordinates: [17.01, 48, 200] };

describe("ThresholdEndSection", () => {
  it("renders a threshold and an end-position block", () => {
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: end }} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("surface-threshold-section")).toBeInTheDocument();
    expect(screen.getByTestId("surface-end-position-section")).toBeInTheDocument();
  });

  it("wraps both blocks in one consolidated container with the swap button in its header", () => {
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: end }} onUpdate={vi.fn()} />);
    const container = screen.getByTestId("surface-threshold-end-section");
    expect(container).toContainElement(screen.getByTestId("surface-threshold-section"));
    expect(container).toContainElement(screen.getByTestId("surface-end-position-section"));
    expect(container).toContainElement(screen.getByTestId("feature-threshold-end-swap"));
  });

  it("routes a threshold edit to onUpdate({ threshold_position })", () => {
    const onUpdate = vi.fn();
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: end }} onUpdate={onUpdate} />);
    fireEvent.change(document.getElementById("feat-threshold-alt")!, { target: { value: "210" } });
    expect(onUpdate).toHaveBeenCalledWith({
      threshold_position: { type: "Point", coordinates: [17, 48, 210] },
    });
  });

  it("routes an end edit to onUpdate({ end_position })", () => {
    const onUpdate = vi.fn();
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: end }} onUpdate={onUpdate} />);
    fireEvent.change(document.getElementById("feat-end-position-alt")!, { target: { value: "211" } });
    expect(onUpdate).toHaveBeenCalledWith({
      end_position: { type: "Point", coordinates: [17.01, 48, 211] },
    });
  });

  it("swap button issues one onUpdate that swaps threshold and end positions", () => {
    const onUpdate = vi.fn();
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: end }} onUpdate={onUpdate} />);
    const swap = screen.getByTestId("feature-threshold-end-swap");
    expect(swap).not.toBeDisabled();
    fireEvent.click(swap);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      threshold_position: end,
      end_position: thr,
    });
  });

  it("disables swap when threshold is missing", () => {
    render(<ThresholdEndSection data={{ threshold_position: null, end_position: end }} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("feature-threshold-end-swap")).toBeDisabled();
  });

  it("disables swap when end is missing", () => {
    render(<ThresholdEndSection data={{ threshold_position: thr, end_position: null }} onUpdate={vi.fn()} />);
    expect(screen.getByTestId("feature-threshold-end-swap")).toBeDisabled();
  });
});
