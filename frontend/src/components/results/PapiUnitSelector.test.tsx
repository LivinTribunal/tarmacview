import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PapiUnitSelector from "./PapiUnitSelector";

const LIGHTS = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"];

describe("PapiUnitSelector", () => {
  it("renders one pill per light, labelled by unit letter", () => {
    render(<PapiUnitSelector lights={LIGHTS} active="PAPI_A" onChange={() => {}} />);
    ["A", "B", "C", "D"].forEach((letter) => {
      expect(screen.getByText(letter)).toBeInTheDocument();
    });
  });

  it("marks the active pill with the accent classes", () => {
    render(<PapiUnitSelector lights={LIGHTS} active="PAPI_B" onChange={() => {}} />);
    const active = screen.getByText("B").closest("button");
    expect(active?.className).toContain("bg-tv-accent");
    expect(active?.getAttribute("aria-pressed")).toBe("true");
  });

  it("fires onChange with the clicked light", () => {
    const onChange = vi.fn();
    render(<PapiUnitSelector lights={LIGHTS} active="PAPI_A" onChange={onChange} />);
    fireEvent.click(screen.getByText("C"));
    expect(onChange).toHaveBeenCalledWith("PAPI_C");
  });
});
