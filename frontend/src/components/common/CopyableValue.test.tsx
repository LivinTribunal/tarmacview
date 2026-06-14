import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import CopyableValue from "./CopyableValue";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

describe("CopyableValue", () => {
  it("renders the raw text by default", () => {
    render(<CopyableValue text="49.171234567" />);
    expect(screen.getByTestId("copyable-value")).toHaveTextContent(
      "49.171234567",
    );
  });

  it("renders custom children while still copying the raw text", () => {
    render(
      <CopyableValue text="234.5">
        <span>234.5 m MSL</span>
      </CopyableValue>,
    );
    const el = screen.getByTestId("copyable-value");
    expect(el).toHaveTextContent("234.5 m MSL");
    fireEvent.click(el);
    expect(writeText).toHaveBeenCalledWith("234.5");
  });

  it("copies on click and shows feedback that clears after 1.5s", () => {
    vi.useFakeTimers();
    try {
      render(<CopyableValue text="18.612345678" />);
      const el = screen.getByTestId("copyable-value");

      fireEvent.click(el);
      expect(writeText).toHaveBeenCalledWith("18.612345678");
      // the value is replaced by "Copied" (same color, no extra badge)
      expect(el).toHaveTextContent("common.copied");
      expect(el).not.toHaveTextContent("18.612345678");
      expect(el).not.toHaveClass("text-tv-success");

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(el).toHaveTextContent("18.612345678");
      expect(el).not.toHaveTextContent("common.copied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies on Enter and Space", () => {
    render(<CopyableValue text="1.23" />);
    const el = screen.getByTestId("copyable-value");

    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.keyDown(el, { key: " " });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenCalledWith("1.23");
  });

  it("is keyboard-focusable via role button", () => {
    render(<CopyableValue text="1.23" />);
    const el = screen.getByRole("button");
    expect(el).toHaveAttribute("tabindex", "0");
  });

  it("applies an animated hover color shift", () => {
    render(<CopyableValue text="1.23" />);
    const el = screen.getByTestId("copyable-value");
    // base is intentionally dimmer than primary so the hover-to-pure-black/white delta is visible
    expect(el).toHaveClass("text-tv-text-primary-soft");
    expect(el).toHaveClass("hover:text-tv-text-primary-hover");
    expect(el).toHaveClass("transition-colors");
    expect(el).toHaveClass("duration-150");
  });

  it("stops propagation so the parent row handler does not fire", () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CopyableValue text="9.9" />
      </div>,
    );
    fireEvent.click(screen.getByTestId("copyable-value"));
    expect(writeText).toHaveBeenCalledWith("9.9");
    expect(parentClick).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.clearAllTimers();
});
