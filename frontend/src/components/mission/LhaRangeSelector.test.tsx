import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LhaRangeSelector from "./LhaRangeSelector";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("LhaRangeSelector", () => {
  it("emits parsed integer values on input change", () => {
    const onChange = vi.fn();
    render(
      <LhaRangeSelector
        params={{ from: null, to: null }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("lha-range-from"), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith({ from: 2, to: null });
  });

  it("flags from > to as invalid", () => {
    render(
      <LhaRangeSelector
        params={{ from: 5, to: 2 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("lha-range-invalid")).toBeTruthy();
  });

  it("does not flag invalid when one bound is empty", () => {
    render(
      <LhaRangeSelector
        params={{ from: 5, to: null }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("lha-range-invalid")).toBeNull();
  });
});
