import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LhaFromThresholdSelector from "./LhaFromThresholdSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("LhaFromThresholdSelector", () => {
  it("renders unavailable message when surface lacks endpoints", () => {
    render(
      <LhaFromThresholdSelector
        params={{ threshold: "START", distance_m: 100 }}
        onChange={vi.fn()}
        available={false}
      />,
    );
    expect(screen.getByTestId("lha-from-threshold-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("lha-from-threshold-selector")).toBeNull();
  });

  it("emits anchor change when toggling end threshold", () => {
    const onChange = vi.fn();
    render(
      <LhaFromThresholdSelector
        params={{ threshold: "START", distance_m: 100 }}
        onChange={onChange}
        available
      />,
    );
    fireEvent.click(screen.getByTestId("lha-from-threshold-anchor-end"));
    expect(onChange).toHaveBeenCalledWith({
      threshold: "END",
      distance_m: 100,
    });
  });

  it("emits distance change as a parsed float", () => {
    const onChange = vi.fn();
    render(
      <LhaFromThresholdSelector
        params={{ threshold: "START", distance_m: 100 }}
        onChange={onChange}
        available
      />,
    );
    fireEvent.change(screen.getByTestId("lha-from-threshold-distance"), {
      target: { value: "50" },
    });
    expect(onChange).toHaveBeenCalledWith({
      threshold: "START",
      distance_m: 50,
    });
  });
});
