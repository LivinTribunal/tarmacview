import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { InspectionResponse } from "@/types/mission";
import type { InspectionMethod } from "@/types/enums";
import FlightParametersSection from "./FlightParametersSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const inspection = (method: InspectionMethod): InspectionResponse => ({
  id: "i-1",
  mission_id: "m-1",
  template_id: "t-1",
  config_id: null,
  method,
  sequence_order: 1,
  lha_ids: null,
  config: null,
});

function renderSection(method: InspectionMethod, onNumberChange = vi.fn()) {
  render(
    <FlightParametersSection
      inspection={inspection(method)}
      altitudeOffset=""
      measurementSpeedOverride=""
      measurementDensity=""
      bufferDistance=""
      hoverDuration=""
      glideSlopeAngleTolerance=""
      speedWarning={false}
      onNumberChange={onNumberChange}
    />,
  );
  return onNumberChange;
}

describe("FlightParametersSection glide-slope tolerance input", () => {
  it("renders the glide-slope tolerance input for a PAPI method", () => {
    renderSection("HORIZONTAL_RANGE");
    expect(screen.getByTestId("inspection-glide-slope-tolerance")).toBeInTheDocument();
  });

  it("does not render the input for a non-PAPI method", () => {
    renderSection("SURFACE_SCAN");
    expect(screen.queryByTestId("inspection-glide-slope-tolerance")).toBeNull();
  });

  it("fires onNumberChange with glide_slope_angle_tolerance on edit", () => {
    const onNumberChange = renderSection("HORIZONTAL_RANGE");
    fireEvent.change(screen.getByTestId("inspection-glide-slope-tolerance"), {
      target: { value: "0.3" },
    });
    expect(onNumberChange).toHaveBeenCalledWith("glide_slope_angle_tolerance", "0.3");
  });
});
