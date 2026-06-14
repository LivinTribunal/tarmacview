import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import InfoHint from "./InfoHint";

describe("InfoHint", () => {
  it("renders the trigger but hides the popover by default", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    expect(screen.getByTestId("hint")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover and closes on mouse leave", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    const trigger = screen.getByTestId("hint");
    const wrapper = trigger.parentElement!;

    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful explanation");

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("toggles open on click", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    const trigger = screen.getByTestId("hint");

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on focus and is keyboard reachable", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    const trigger = screen.getByTestId("hint");

    trigger.focus();
    fireEvent.focus(trigger);
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the trigger", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    const trigger = screen.getByTestId("hint");

    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on outside mousedown", () => {
    render(
      <div>
        <InfoHint text="Helpful explanation" testId="hint" />
        <button type="button" data-testid="outside">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("hint"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("exposes aria-describedby pointing to the popover when open", () => {
    render(<InfoHint text="Helpful explanation" testId="hint" />);
    const trigger = screen.getByTestId("hint");

    fireEvent.click(trigger);
    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("uses the provided label as the trigger's aria-label", () => {
    render(<InfoHint text="copy" label="More info: transit altitude" testId="hint" />);
    expect(screen.getByTestId("hint")).toHaveAttribute(
      "aria-label",
      "More info: transit altitude",
    );
  });

  it("falls back to the translated common.showHelp key when no label is given", () => {
    render(<InfoHint text="copy" testId="hint" />);
    expect(screen.getByTestId("hint")).toHaveAttribute("aria-label", "common.showHelp");
  });
});
