import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import DetailSelector from "./DetailSelector";

function renderSelector(isOpen: boolean) {
  return render(
    <DetailSelector
      title="Templates"
      count={3}
      actions={[]}
      renderSelected={() => <span>Selected item</span>}
      isOpen={isOpen}
      onToggle={vi.fn()}
      searchValue=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Search..."
      noResultsText="No results"
      renderDropdownItems={() => null}
    />,
  );
}

describe("DetailSelector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("focuses the search input shortly after opening", () => {
    /** the open effect schedules a setTimeout focus on the search input. */
    renderSelector(true);
    const input = screen.getByPlaceholderText("Search...");
    expect(document.activeElement).not.toBe(input);

    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(input);
  });

  it("clears the pending focus timer when unmounted before it fires", () => {
    /** the effect cleanup must clearTimeout so a rapid open->unmount does not
     *  call focus() on a detached node. */
    const { unmount } = renderSelector(true);
    const input = screen.getByPlaceholderText("Search...") as HTMLInputElement;
    const focusSpy = vi.spyOn(input, "focus");

    unmount();
    act(() => {
      vi.runAllTimers();
    });
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
