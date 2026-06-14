import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FormSection from "./FormSection";

describe("FormSection", () => {
  /** test suite for FormSection wrapper. */
  it("renders the title and children", () => {
    /** verify heading + body are present. */
    render(
      <FormSection title="Drone & speeds">
        <input data-testid="child-field" />
      </FormSection>,
    );
    expect(screen.getByText("Drone & speeds")).toBeInTheDocument();
    expect(screen.getByTestId("child-field")).toBeInTheDocument();
  });

  it("renders heading with uppercase + section testid", () => {
    /** verify uppercase heading style and the testId pass-through. */
    render(
      <FormSection title="Camera settings" testId="section-camera">
        <span>body</span>
      </FormSection>,
    );
    const section = screen.getByTestId("section-camera");
    expect(section.tagName).toBe("SECTION");
    const heading = section.querySelector("h3");
    expect(heading).not.toBeNull();
    expect(heading?.className).not.toMatch(/uppercase/);
    expect(heading?.className).toMatch(/text-tv-text-primary/);
  });

  it("first section drops the divider via tailwind first: variant", () => {
    /** verify both border-t and first:border-t-0 classes are present so adjacent sections show dividers. */
    render(
      <FormSection title="One" testId="s1">
        <span>a</span>
      </FormSection>,
    );
    const section = screen.getByTestId("s1");
    expect(section.className).toMatch(/border-t/);
    expect(section.className).toMatch(/first:border-t-0/);
  });

  it("renders the meta slot next to the heading when provided", () => {
    /** verify optional meta content sits in the heading row. */
    render(
      <FormSection
        title="Direction"
        testId="s-meta"
        meta={<span data-testid="meta-content">42°</span>}
      >
        <span>body</span>
      </FormSection>,
    );
    expect(screen.getByTestId("meta-content")).toBeInTheDocument();
  });
});
