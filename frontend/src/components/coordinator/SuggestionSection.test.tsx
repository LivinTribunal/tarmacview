import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SuggestionSection from "./SuggestionSection";

interface Item {
  label: string;
  checked: boolean;
}

const items: Item[] = [
  { label: "alpha", checked: true },
  { label: "beta", checked: false },
];

function renderSection(props: Partial<React.ComponentProps<typeof SuggestionSection<Item>>> = {}) {
  /** render the section with sensible defaults and return the spies. */
  const onToggleSection = vi.fn();
  const onSetSectionChecked = vi.fn();
  const onToggleItem = vi.fn();
  const utils = render(
    <SuggestionSection<Item>
      title="Runways"
      count={items.length}
      items={items}
      expanded={true}
      testIdPrefix="runway-suggestion"
      keyPrefix="rw"
      onToggleSection={onToggleSection}
      onSetSectionChecked={onSetSectionChecked}
      onToggleItem={onToggleItem}
      renderItem={(item) => <>{item.label}</>}
      {...props}
    />,
  );
  return { ...utils, onToggleSection, onSetSectionChecked, onToggleItem };
}

describe("SuggestionSection", () => {
  it("renders the title with the count and the rendered items", () => {
    renderSection();

    expect(screen.getByText("Runways (2)")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("wires checkboxes to the indexed testIdPrefix and checked state", () => {
    renderSection();

    expect(screen.getByTestId("runway-suggestion-0")).toBeChecked();
    expect(screen.getByTestId("runway-suggestion-1")).not.toBeChecked();
  });

  it("hides the list when collapsed", () => {
    renderSection({ expanded: false });

    expect(screen.queryByTestId("runway-suggestion-0")).not.toBeInTheDocument();
    expect(screen.getByText("Runways (2)")).toBeInTheDocument();
  });

  it("calls onToggleSection when the header is clicked", () => {
    const { onToggleSection } = renderSection();

    fireEvent.click(screen.getByText("Runways (2)"));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
  });

  it("calls onSetSectionChecked from the all / none controls", () => {
    const { onSetSectionChecked } = renderSection();

    fireEvent.click(screen.getByText("coordinator.createAirport.lookup.all"));
    fireEvent.click(screen.getByText("coordinator.createAirport.lookup.none"));

    expect(onSetSectionChecked).toHaveBeenNthCalledWith(1, true);
    expect(onSetSectionChecked).toHaveBeenNthCalledWith(2, false);
  });

  it("calls onToggleItem with the item index", () => {
    const { onToggleItem } = renderSection();

    fireEvent.click(screen.getByTestId("runway-suggestion-1"));
    expect(onToggleItem).toHaveBeenCalledWith(1);
  });
});
