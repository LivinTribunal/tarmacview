import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MapHelpPanel, { type MapHelpVariant } from "./MapHelpPanel";

// react-i18next is globally mocked to echo keys, so kbd labels render verbatim
function expand(variant?: MapHelpVariant) {
  render(<MapHelpPanel variant={variant} />);
  fireEvent.click(screen.getByTestId("map-help-btn"));
}

describe("MapHelpPanel", () => {
  it("full variant lists S/W/M shortcuts and the tool descriptions", () => {
    expand("full");
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("W")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("map.help.toolDescriptions")).toBeInTheDocument();
  });

  it("preview variant shows only the minimal shortcuts and preview tools", () => {
    expand("preview");
    expect(screen.getByText("map.help.middleMouse")).toBeInTheDocument();
    expect(screen.getByText("map.help.scroll")).toBeInTheDocument();
    expect(screen.queryByText("W")).not.toBeInTheDocument();
    expect(screen.getByText("map.help.toolDescriptions")).toBeInTheDocument();
  });

  it("coordinator variant lists drawing/edit shortcuts, the hint, and no tool descriptions", () => {
    expand("coordinator");
    ["G", "C", "E", "T", "Del"].forEach((key) =>
      expect(screen.getByText(key)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("click-locate-hint")).toHaveTextContent(
      "coordinator.airports.help.clickSelectDblLocate",
    );
    expect(screen.queryByText("map.help.toolDescriptions")).not.toBeInTheDocument();
  });

  it("coordinator collapsed button uses the coordinator namespace", () => {
    render(<MapHelpPanel variant="coordinator" />);
    expect(screen.getByTestId("map-help-btn")).toHaveTextContent(
      "coordinator.airports.help.controls",
    );
  });
});
