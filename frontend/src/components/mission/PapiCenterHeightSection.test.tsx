import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PapiCenterHeightSection from "./PapiCenterHeightSection";

describe("PapiCenterHeightSection", () => {
  it("renders the Ground/Lens/Custom toggle and hides the custom input outside CUSTOM", () => {
    render(
      <PapiCenterHeightSection
        papiCenterHeightReference="GROUND"
        papiCenterHeightCustomM=""
        configOverride={{}}
        onChange={vi.fn()}
        onNumberChange={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId("inspection-papi-center-height-reference");
    expect(toggle.querySelectorAll("button")).toHaveLength(3);
    expect(
      screen.getByTestId("inspection-papi-center-height-reference-ground"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspection-papi-center-height-reference-lens"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspection-papi-center-height-reference-custom"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("inspection-papi-center-height-custom"),
    ).not.toBeInTheDocument();
  });

  it("shows the custom input only when reference is CUSTOM", () => {
    render(
      <PapiCenterHeightSection
        papiCenterHeightReference="CUSTOM"
        papiCenterHeightCustomM={5}
        configOverride={{}}
        onChange={vi.fn()}
        onNumberChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("inspection-papi-center-height-custom"),
    ).toBeInTheDocument();
  });

  it("emits the chosen reference via onChange", () => {
    const onChange = vi.fn();
    render(
      <PapiCenterHeightSection
        papiCenterHeightReference="GROUND"
        papiCenterHeightCustomM=""
        configOverride={{ buffer_distance: 2 }}
        onChange={onChange}
        onNumberChange={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByTestId("inspection-papi-center-height-reference-custom"),
    );
    // preserves the rest of the override and sets the reference
    expect(onChange).toHaveBeenCalledWith({
      buffer_distance: 2,
      papi_center_height_reference: "CUSTOM",
    });
  });

  it("emits the custom height via onNumberChange", () => {
    const onNumberChange = vi.fn();
    render(
      <PapiCenterHeightSection
        papiCenterHeightReference="CUSTOM"
        papiCenterHeightCustomM=""
        configOverride={{}}
        onChange={vi.fn()}
        onNumberChange={onNumberChange}
      />,
    );
    fireEvent.change(screen.getByTestId("inspection-papi-center-height-custom"), {
      target: { value: "7.5" },
    });
    expect(onNumberChange).toHaveBeenCalledWith("papi_center_height_custom_m", "7.5");
  });
});
