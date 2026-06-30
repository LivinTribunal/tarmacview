import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MapInfoCard from "./MapInfoCard";

describe("MapInfoCard", () => {
  it("renders the title, children, and fires onClose", () => {
    const onClose = vi.fn();
    render(
      <MapInfoCard title="My Card" onClose={onClose} testId="my-card">
        <p>body content</p>
      </MapInfoCard>,
    );
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
    expect(screen.getByText("My Card")).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("common.close"));
    expect(onClose).toHaveBeenCalled();
  });
});
