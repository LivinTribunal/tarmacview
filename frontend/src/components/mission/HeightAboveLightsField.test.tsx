import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import HeightAboveLightsField from "./HeightAboveLightsField";

describe("HeightAboveLightsField", () => {
  it("renders the height input and emits height_above_lights on change", () => {
    const onNumberChange = vi.fn();
    render(
      <HeightAboveLightsField
        heightAboveLights={3}
        onNumberChange={onNumberChange}
        hintTestId="hint-x"
      />,
    );
    const input = screen.getByTestId("inspection-height-above-lights");
    fireEvent.change(input, { target: { value: "5" } });
    expect(onNumberChange).toHaveBeenCalledWith("height_above_lights", "5");
    expect(screen.getByTestId("hint-x")).toBeInTheDocument();
  });
});
