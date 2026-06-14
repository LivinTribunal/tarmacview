import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LhaSelectionModeToggle from "./LhaSelectionModeToggle";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("LhaSelectionModeToggle", () => {
  it("renders all four modes", () => {
    render(<LhaSelectionModeToggle mode="ALL" onChange={vi.fn()} />);
    expect(screen.getByTestId("lha-selection-mode-all")).toBeTruthy();
    expect(screen.getByTestId("lha-selection-mode-range")).toBeTruthy();
    expect(screen.getByTestId("lha-selection-mode-from_threshold")).toBeTruthy();
    expect(screen.getByTestId("lha-selection-mode-custom")).toBeTruthy();
  });

  it("fires onChange with the clicked mode", () => {
    const onChange = vi.fn();
    render(<LhaSelectionModeToggle mode="ALL" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("lha-selection-mode-range"));
    expect(onChange).toHaveBeenCalledWith("RANGE");
  });

  it("disables FROM_THRESHOLD when surface lacks endpoints", () => {
    const onChange = vi.fn();
    render(
      <LhaSelectionModeToggle
        mode="ALL"
        onChange={onChange}
        fromThresholdAvailable={false}
      />,
    );
    const btn = screen.getByTestId(
      "lha-selection-mode-from_threshold",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });
});
