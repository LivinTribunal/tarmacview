import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PageLoadState from "./PageLoadState";

describe("PageLoadState", () => {
  it("renders the spinner while loading", () => {
    const { container } = render(
      <PageLoadState loading error={null} onRetry={vi.fn()}>
        <div data-testid="body" />
      </PageLoadState>,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(screen.queryByTestId("body")).toBeNull();
  });

  it("renders the error + retry button and calls onRetry on click", () => {
    const onRetry = vi.fn();
    render(
      <PageLoadState loading={false} error="boom" onRetry={onRetry}>
        <div data-testid="body" />
      </PageLoadState>,
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByText("common.retry"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("body")).toBeNull();
  });

  it("renders children when neither loading nor error", () => {
    render(
      <PageLoadState loading={false} error={null} onRetry={vi.fn()}>
        <div data-testid="body" />
      </PageLoadState>,
    );
    expect(screen.getByTestId("body")).toBeInTheDocument();
  });
});
