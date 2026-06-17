import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MeasurementStatusChip from "./MeasurementStatusChip";

describe("MeasurementStatusChip", () => {
  it("renders the localized phase label for a terminal status without a spinner", () => {
    const { container } = render(<MeasurementStatusChip status="DONE" />);
    expect(screen.getByTestId("measurement-status-chip")).toHaveTextContent(
      "measurementsList.status.DONE",
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("spins while the worker is actively processing", () => {
    const { container } = render(<MeasurementStatusChip status="PROCESSING" />);
    expect(screen.getByTestId("measurement-status-chip")).toHaveTextContent(
      "measurementsList.status.PROCESSING",
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("forwards an extra className", () => {
    render(<MeasurementStatusChip status="ERROR" className="ml-2" />);
    expect(screen.getByTestId("measurement-status-chip")).toHaveClass("ml-2");
  });
});
