import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuditLogFilterBar from "./AuditLogFilterBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

function baseProps() {
  return {
    airportIdFilter: null as string | null,
    scopedAirport: null,
    onClearAirportFilter: vi.fn(),
    actionFilter: null as string | null,
    onToggleAction: vi.fn(),
    entityTypeFilter: null as string | null,
    onToggleEntityType: vi.fn(),
    dateFrom: "",
    onDateFromChange: vi.fn(),
    dateTo: "",
    onDateToChange: vi.fn(),
  };
}

describe("AuditLogFilterBar", () => {
  it("renders action + entity pills and date inputs with their test ids", () => {
    render(<AuditLogFilterBar {...baseProps()} />);
    expect(screen.getByTestId("action-pill-LOGIN")).toBeInTheDocument();
    expect(screen.getByTestId("entity-type-pill-User")).toBeInTheDocument();
    expect(screen.getByTestId("date-from")).toBeInTheDocument();
    expect(screen.getByTestId("date-to")).toBeInTheDocument();
    expect(screen.queryByTestId("airport-scope-chip")).not.toBeInTheDocument();
  });

  it("forwards pill toggles and date changes to the callbacks", () => {
    const props = baseProps();
    render(<AuditLogFilterBar {...props} />);

    fireEvent.click(screen.getByTestId("action-pill-LOGIN"));
    expect(props.onToggleAction).toHaveBeenCalledWith("LOGIN");

    fireEvent.click(screen.getByTestId("entity-type-pill-User"));
    expect(props.onToggleEntityType).toHaveBeenCalledWith("User");

    fireEvent.change(screen.getByTestId("date-from"), {
      target: { value: "2026-03-01" },
    });
    expect(props.onDateFromChange).toHaveBeenCalledWith("2026-03-01");

    fireEvent.change(screen.getByTestId("date-to"), {
      target: { value: "2026-03-31" },
    });
    expect(props.onDateToChange).toHaveBeenCalledWith("2026-03-31");
  });

  it("renders the scope chip and clears it when airportIdFilter is set", () => {
    const props = {
      ...baseProps(),
      airportIdFilter: "apt-9",
      scopedAirport: {
        id: "apt-9",
        icao_code: "LZIB",
        name: "Bratislava",
        city: null,
        country: null,
        user_count: 0,
        coordinator_count: 0,
        operator_count: 0,
        mission_count: 0,
        drone_count: 0,
        terrain_source: "FLAT",
        created_at: null,
      },
    };
    render(<AuditLogFilterBar {...props} />);
    expect(screen.getByTestId("airport-scope-chip")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("airport-scope-clear"));
    expect(props.onClearAirportFilter).toHaveBeenCalled();
  });
});
