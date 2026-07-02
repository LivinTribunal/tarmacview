import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DeviceEvaluationRow } from "@/types/measurement";
import MissionEvaluationTable from "./MissionEvaluationTable";

function row(over: Partial<DeviceEvaluationRow> = {}): DeviceEvaluationRow {
  return {
    device_label: "PAPI 06",
    result: "PASS",
    restrictions: null,
    recommendations: null,
    ...over,
  };
}

describe("MissionEvaluationTable", () => {
  it("renders one row per device with a result pill", () => {
    render(
      <MissionEvaluationTable
        evaluation={[row(), row({ device_label: "PAPI 24", result: "FAIL" })]}
      />,
    );
    expect(screen.getByTestId("mission-evaluation-table")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-PASS")).toBeInTheDocument();
    expect(screen.getByTestId("evaluation-FAIL")).toBeInTheDocument();
  });

  it("renders an em dash for null restrictions and recommendations", () => {
    render(<MissionEvaluationTable evaluation={[row()]} />);
    const cells = screen.getAllByText("—");
    expect(cells).toHaveLength(2);
  });

  it("shows an empty state when there are no devices", () => {
    render(<MissionEvaluationTable evaluation={[]} />);
    expect(
      screen.queryByTestId("mission-evaluation-table"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("results.overview.evaluation.empty"),
    ).toBeInTheDocument();
  });
});
