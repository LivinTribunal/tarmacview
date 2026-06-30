import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ZoomDropdown from "./ZoomDropdown";

type Props = React.ComponentProps<typeof ZoomDropdown>;

function renderDropdown(overrides: Partial<Props> = {}) {
  const props: Props = {
    zoomPercent: 100,
    onZoomTo: vi.fn(),
    ariaLabel: "zoom-to",
    ...overrides,
  };
  return { ...render(<ZoomDropdown {...props} />), props };
}

describe("ZoomDropdown", () => {
  it("is closed by default and opens on field click", () => {
    renderDropdown();
    expect(screen.getByTestId("zoom-field")).toHaveTextContent("100%");
    expect(screen.queryByTestId("zoom-input")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("zoom-field"));
    expect(screen.getByTestId("zoom-input")).toBeInTheDocument();
  });

  it("applies a preset and closes", () => {
    const { props } = renderDropdown();
    fireEvent.click(screen.getByTestId("zoom-field"));
    fireEvent.click(screen.getByText("150%"));
    expect(props.onZoomTo).toHaveBeenCalledWith(150);
    expect(screen.queryByTestId("zoom-input")).not.toBeInTheDocument();
  });

  it("applies a valid custom input on Enter", () => {
    const { props } = renderDropdown();
    fireEvent.click(screen.getByTestId("zoom-field"));
    const input = screen.getByTestId("zoom-input");
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onZoomTo).toHaveBeenCalledWith(250);
  });

  it("ignores NaN and out-of-range custom input", () => {
    const { props } = renderDropdown({ maxPercent: 1000 });
    fireEvent.click(screen.getByTestId("zoom-field"));
    const input = screen.getByTestId("zoom-input");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByTestId("zoom-field"));
    fireEvent.change(screen.getByTestId("zoom-input"), { target: { value: "5000" } });
    fireEvent.keyDown(screen.getByTestId("zoom-input"), { key: "Enter" });
    expect(props.onZoomTo).not.toHaveBeenCalled();
  });

  it("renders only the presets passed in", () => {
    renderDropdown({ presets: [50, 100, 500] });
    fireEvent.click(screen.getByTestId("zoom-field"));
    expect(screen.getByText("500%")).toBeInTheDocument();
    expect(screen.queryByText("300%")).not.toBeInTheDocument();
  });
});
