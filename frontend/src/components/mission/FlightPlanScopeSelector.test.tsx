import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FlightPlanScopeSelector from "./FlightPlanScopeSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("FlightPlanScopeSelector", () => {
  /** tests for the flight plan scope radio selector. */

  it("renders both airborne scope options and omits the dropped legacy value", () => {
    render(
      <FlightPlanScopeSelector value="FULL" onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("scope-option-FULL")).toBeTruthy();
    expect(screen.getByTestId("scope-option-MEASUREMENTS_ONLY")).toBeTruthy();
    expect(screen.queryByTestId("scope-option-NO_TAKEOFF_LANDING")).toBeNull();
  });

  it("marks the active option as checked", () => {
    render(
      <FlightPlanScopeSelector value="FULL" onChange={vi.fn()} />,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const checked = radios.filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].value).toBe("FULL");
  });

  it("calls onChange with the selected scope value", () => {
    const onChange = vi.fn();
    render(<FlightPlanScopeSelector value="FULL" onChange={onChange} />);
    const moRadio = screen.getByDisplayValue("MEASUREMENTS_ONLY");
    fireEvent.click(moRadio);
    expect(onChange).toHaveBeenCalledWith("MEASUREMENTS_ONLY");
  });

  it("disables all radios when disabled prop is true", () => {
    render(
      <FlightPlanScopeSelector value="FULL" onChange={vi.fn()} disabled />,
    );
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.every((r) => r.disabled)).toBe(true);
  });

  it("shows the airborne-start note for MEASUREMENTS_ONLY", () => {
    render(
      <FlightPlanScopeSelector value="MEASUREMENTS_ONLY" onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("airborne-start-note")).toBeTruthy();
  });

  it("shows the airborne-start note for FULL", () => {
    render(
      <FlightPlanScopeSelector value="FULL" onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("airborne-start-note")).toBeTruthy();
  });
});
