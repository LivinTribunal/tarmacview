import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MEASUREMENT_POLL_INTERVAL_MS } from "@/constants/ui";
import en from "@/i18n/locales/en.json";
import type { MeasurementListItem } from "@/types/measurement";
import MeasurementsListPage from "./MeasurementsListPage";
import {
  deleteMeasurement,
  listAirportMeasurements,
  updateMeasurement,
} from "@/api/measurements";

/** resolve a dotted i18n key against the real en.json bundle. */
function resolveKey(key: string): string {
  const parts = key.split(".");
  let node: unknown = en as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

/** i18next-style t: second arg is a default string or an interpolation map. */
const stableT = (key: string, opts?: unknown) => {
  let s = resolveKey(key);
  if (typeof opts === "string") return s === key ? opts : s;
  if (opts && typeof opts === "object") {
    for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
      s = s.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    }
  }
  return s;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const { navigateMock, airportHolder } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  airportHolder: { current: null as { id: string; name: string } | null },
}));

vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: airportHolder.current }),
}));

vi.mock("@/api/measurements", () => ({
  listAirportMeasurements: vi.fn(),
  deleteMeasurement: vi.fn(),
  updateMeasurement: vi.fn(),
}));

vi.mock("@/contexts/MeasurementProgressContext", () => ({
  useMeasurementProgress: () => ({ activeCount: 0, track: vi.fn(), sync: vi.fn() }),
}));

// stub the heavy flow dialog - its own test covers the review internals
vi.mock("@/components/mission/MeasurementFlowDialog", () => ({
  default: ({ measurementId }: { measurementId?: string }) => (
    <div data-testid="flow-dialog" data-measurement={measurementId} />
  ),
}));

const listMock = vi.mocked(listAirportMeasurements);
const deleteMock = vi.mocked(deleteMeasurement);
const updateMock = vi.mocked(updateMeasurement);

function row(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-1",
    mission_name: "Demo Mission",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
    label: null,
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 3,
    fail_count: 1,
    error_message: null,
    ...over,
  };
}

describe("MeasurementsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    airportHolder.current = { id: "airport-1", name: "Demo Airport" };
    listMock.mockResolvedValue([]);
  });

  it("shows the no-airport state when no airport is selected", () => {
    airportHolder.current = null;
    render(<MeasurementsListPage />);
    expect(screen.getByTestId("measurements-no-airport")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("shows the empty state when the airport has no measurements", async () => {
    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-empty")).toBeInTheDocument(),
    );
    expect(listMock).toHaveBeenCalledWith("airport-1");
  });

  it("renders the shared table from airport context and routes each status", async () => {
    listMock.mockResolvedValue([
      row({ id: "done-1", status: "DONE", mission_name: "Alpha" }),
      row({
        id: "confirm-1",
        status: "AWAITING_CONFIRM",
        mission_name: "Bravo",
        inspection_sequence_order: 2,
        has_results: false,
        pass_count: 0,
        fail_count: 0,
      }),
      row({
        id: "proc-1",
        status: "PROCESSING",
        mission_name: "Charlie",
        inspection_sequence_order: 3,
        has_results: false,
      }),
      row({
        id: "err-1",
        status: "ERROR",
        mission_name: "Delta",
        inspection_sequence_order: 4,
        has_results: false,
        error_message: "processing failed: boom",
      }),
    ]);

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );

    // mission name renders in the shared table (scoped past the mission filter options)
    expect(
      within(screen.getByTestId("measurements-table")).getByText("Alpha"),
    ).toBeInTheDocument();

    // DONE -> results page
    fireEvent.click(screen.getByTestId("measurement-row-done-1"));
    expect(navigateMock).toHaveBeenCalledWith(
      "/operator-center/measurements/done-1/results",
    );

    // active run -> inert (the corner progress toast tracks it, no modal)
    fireEvent.click(screen.getByTestId("measurement-row-proc-1"));
    expect(screen.queryByTestId("flow-dialog")).not.toBeInTheDocument();

    // AWAITING_CONFIRM -> open the box-review modal for that run
    fireEvent.click(screen.getByTestId("measurement-row-confirm-1"));
    expect(await screen.findByTestId("flow-dialog")).toHaveAttribute(
      "data-measurement",
      "confirm-1",
    );

    // error row surfaces its message inline
    expect(screen.getByTestId("error-err-1")).toHaveTextContent(
      "processing failed: boom",
    );
  });

  it("filters the table by status pill and mission select", async () => {
    listMock.mockResolvedValue([
      row({ id: "done-1", status: "DONE", mission_id: "m-alpha", mission_name: "Alpha" }),
      row({
        id: "proc-1",
        status: "PROCESSING",
        mission_id: "m-bravo",
        mission_name: "Bravo",
        inspection_sequence_order: 2,
        has_results: false,
      }),
    ]);

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );

    // both rows visible by default (every status pill active)
    expect(screen.getByTestId("measurement-row-done-1")).toBeInTheDocument();
    expect(screen.getByTestId("measurement-row-proc-1")).toBeInTheDocument();

    // isolate DONE via the status pill -> only the done row remains
    fireEvent.click(screen.getByTestId("status-filter-DONE"));
    expect(screen.getByTestId("measurement-row-done-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("measurement-row-proc-1"),
    ).not.toBeInTheDocument();

    // reset, then narrow by the mission select
    fireEvent.click(screen.getByTestId("filter-bar-reset"));
    fireEvent.change(screen.getByTestId("mission-filter"), {
      target: { value: "m-bravo" },
    });
    expect(
      screen.queryByTestId("measurement-row-done-1"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("measurement-row-proc-1")).toBeInTheDocument();
  });

  it("auto-refreshes the list while a run is still processing, then stops", async () => {
    vi.useFakeTimers();
    try {
      listMock
        .mockResolvedValueOnce([
          row({ id: "p1", status: "PROCESSING", has_results: false }),
        ])
        .mockResolvedValue([row({ id: "p1", status: "DONE" })]);

      render(<MeasurementsListPage />);

      // initial load -> processing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(listMock).toHaveBeenCalledTimes(1);

      // one poll interval later the list silently refetches and flips to done
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MEASUREMENT_POLL_INTERVAL_MS);
      });
      expect(listMock).toHaveBeenCalledTimes(2);

      // no active run remains -> polling stops
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MEASUREMENT_POLL_INTERVAL_MS * 3);
      });
      expect(listMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces a load error with a retry", async () => {
    listMock.mockRejectedValueOnce(new Error("boom"));
    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(
        screen.getByText(en.measurementsList.loadError),
      ).toBeInTheDocument(),
    );

    listMock.mockResolvedValueOnce([row({ id: "done-1", status: "DONE" })]);
    fireEvent.click(screen.getByText(en.measurementsList.retry));
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );
  });

  it("renders the operator label when set, else the inspection fallback", async () => {
    listMock.mockResolvedValue([
      row({ id: "named-1", label: "morning re-fly", mission_name: "Alpha" }),
      row({
        id: "plain-1",
        label: null,
        inspection_sequence_order: 2,
        mission_name: "Bravo",
      }),
    ]);

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );

    const table = screen.getByTestId("measurements-table");
    expect(within(table).getByText("morning re-fly")).toBeInTheDocument();
    expect(within(table).getByText(/Inspection 2/)).toBeInTheDocument();
  });

  it("deletes a row through the confirm modal and refetches", async () => {
    listMock.mockResolvedValue([
      row({ id: "done-1", status: "DONE", label: "morning re-fly" }),
    ]);
    deleteMock.mockResolvedValue(undefined);

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );
    expect(listMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle(en.measurementsList.actions.delete));
    fireEvent.click(screen.getByTestId("confirm-delete-measurement"));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("done-1"));
    // the list refetches after a successful delete
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("renames a row through the rename modal", async () => {
    listMock.mockResolvedValue([row({ id: "done-1", status: "DONE", label: null })]);
    updateMock.mockResolvedValue({
      id: "done-1",
      inspection_id: "i1",
      status: "DONE",
      label: "named run",
      error_message: null,
    });

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-table")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTitle(en.measurementsList.actions.rename));
    fireEvent.change(screen.getByTestId("measurement-rename-input"), {
      target: { value: "named run" },
    });
    fireEvent.click(screen.getByTestId("confirm-rename-measurement"));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("done-1", "named run"),
    );
  });
});
