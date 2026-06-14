import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReadOnlyField from "./ReadOnlyField";

describe("ReadOnlyField", () => {
  /** test suite for read-only display field. */
  it("renders the label and the value", () => {
    /** verify label + value text both render. */
    render(<ReadOnlyField label="Template" value="Runway Inspection" />);
    expect(screen.getByText("Template")).toBeInTheDocument();
    expect(screen.getByText("Runway Inspection")).toBeInTheDocument();
  });

  it("marks the value container as aria-readonly with no input role", () => {
    /** verify a11y signals: aria-readonly is set, no editable input rendered. */
    render(
      <ReadOnlyField label="Method" value="Fly Over" testId="ro-method" />,
    );
    const value = screen.getByTestId("ro-method");
    expect(value.getAttribute("aria-readonly")).toBe("true");
    expect(value.tagName).not.toBe("INPUT");
    expect(value.querySelector("input")).toBeNull();
  });

  it("uses bg-tv-surface to differentiate from interactive inputs", () => {
    /** verify pill background is bg-tv-surface so readers can tell it apart from inputs sitting on bg-tv-bg. */
    render(<ReadOnlyField label="X" value="Y" testId="ro-x" />);
    const value = screen.getByTestId("ro-x");
    expect(value.className).toMatch(/bg-tv-surface/);
    expect(value.className).toMatch(/border-tv-border/);
  });

  it("renders rich react node values, not just strings", () => {
    /** verify ReactNode values render through. */
    render(
      <ReadOnlyField
        label="Computed angle"
        value={<span data-testid="ro-rich">3.5°</span>}
      />,
    );
    expect(screen.getByTestId("ro-rich")).toBeInTheDocument();
  });
});
