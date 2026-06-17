import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from "react-router";
import en from "@/i18n/locales/en.json";
import type { MeasurementListItem } from "@/types/measurement";
import MeasurementTabNav from "./MeasurementTabNav";
import {
  deleteMeasurement,
  downloadMeasurementReport,
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

const { airportHolder } = vi.hoisted(() => ({
  airportHolder: { current: null as { id: string; name: string } | null },
}));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: airportHolder.current }),
}));

vi.mock("@/api/measurements", () => ({
  listAirportMeasurements: vi.fn(),
  downloadMeasurementReport: vi.fn(),
  updateMeasurement: vi.fn(),
  deleteMeasurement: vi.fn(),
}));

const listMock = vi.mocked(listAirportMeasurements);
const downloadMock = vi.mocked(downloadMeasurementReport);
const updateMock = vi.mocked(updateMeasurement);
const deleteMock = vi.mocked(deleteMeasurement);

function row(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-a",
    mission_name: "Alpha",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 1,
    fail_count: 3,
    label: null,
    error_message: null,
    ...over,
  };
}

/** surfaces the active route path so navigation can be asserted. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderNav(measurementId = "m1") {
  return render(
    <MemoryRouter
      initialEntries={[`/operator-center/measurements/${measurementId}/results`]}
    >
      <Routes>
        <Route
          path="/operator-center/measurements/:measurementId/results"
          element={<MeasurementTabNav />}
        >
          <Route index element={<div data-testid="results-body" />} />
        </Route>
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("MeasurementTabNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    airportHolder.current = { id: "airport-1", name: "Demo Airport" };
    listMock.mockResolvedValue([
      row({ id: "m1", mission_id: "mission-a", inspection_sequence_order: 1 }),
      row({
        id: "m2",
        mission_id: "mission-a",
        inspection_sequence_order: 2,
        inspection_method: "VERTICAL_PROFILE",
      }),
      row({
        id: "m3",
        mission_id: "mission-b",
        inspection_sequence_order: 1,
        inspection_method: "FLY_OVER",
      }),
    ]);
  });

  it("renders the outlet body and a single All section tab", async () => {
    renderNav();
    await waitFor(() =>
      expect(screen.getByTestId("results-body")).toBeInTheDocument(),
    );
    const tabs = screen.getByTestId("measurement-section-tabs");
    expect(within(tabs).getAllByRole("button")).toHaveLength(1);
    expect(within(tabs).getByText("All")).toBeInTheDocument();
  });

  it("scopes the picker to the current mission and navigates on select", async () => {
    renderNav("m1");
    // wait for the airport list to load and seed the picker
    await waitFor(() => expect(listMock).toHaveBeenCalledWith("airport-1"));

    // open the picker dropdown (click the current run's trigger label)
    fireEvent.click(screen.getByText("Inspection 1 · Horizontal Range"));

    // mission-a's second run shows up in the dropdown
    await waitFor(() =>
      expect(
        screen.getByText("Inspection 2 · Vertical Profile"),
      ).toBeInTheDocument(),
    );
    // mission-b's run (m3) is scoped out entirely
    expect(screen.queryByText("Inspection 1 · Fly Over")).toBeNull();

    fireEvent.click(screen.getByText("Inspection 2 · Vertical Profile"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/operator-center/measurements/m2/results",
      ),
    );
  });

  it("renders the pass rollup from the current run's tallies", async () => {
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("pass-rollup")).toHaveTextContent("1/4 pass"),
    );
  });

  it("downloads the report from the header button", async () => {
    downloadMock.mockResolvedValue({
      blob: new Blob(["pdf"]),
      filename: "report.pdf",
    });
    // jsdom lacks object-url + anchor click plumbing - stub what the handler touches
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:report");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderNav("m1");
    fireEvent.click(screen.getByTestId("download-pdf-btn"));

    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith("m1"));
    expect(createUrl).toHaveBeenCalled();
    revokeUrl.mockRestore();
    createUrl.mockRestore();
  });

  it("shows the operator label in the pill, falling back to the inspection label", async () => {
    listMock.mockResolvedValueOnce([
      row({ id: "m1", mission_id: "mission-a", label: "morning re-fly" }),
    ]);
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("measurement-selector")).toHaveTextContent(
        "morning re-fly",
      ),
    );
    expect(screen.getByTestId("measurement-selector")).not.toHaveTextContent(
      "Inspection 1 · Horizontal Range",
    );
  });

  it("renders the run status badge in the header", async () => {
    listMock.mockResolvedValueOnce([
      row({ id: "m1", mission_id: "mission-a", status: "DONE" }),
    ]);
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("measurement-status-chip")).toHaveTextContent(
        "Done",
      ),
    );
  });

  it("renames the run from the picker and updates the pill name", async () => {
    updateMock.mockResolvedValue({
      id: "m1",
      inspection_id: "i1",
      status: "DONE",
      label: "evening run",
      error_message: null,
    });
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("measurement-selector")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("rename-measurement-btn"));
    fireEvent.change(screen.getByTestId("measurement-rename-input"), {
      target: { value: "evening run" },
    });
    fireEvent.click(screen.getByTestId("confirm-rename-measurement"));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("m1", "evening run"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("measurement-selector")).toHaveTextContent(
        "evening run",
      ),
    );
  });

  it("deletes the run from the picker and routes back to the list", async () => {
    deleteMock.mockResolvedValue(undefined);
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("measurement-selector")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("delete-measurement-btn"));
    fireEvent.click(screen.getByTestId("confirm-delete-measurement"));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("m1"));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/operator-center/measurements",
      ),
    );
  });

  it("deselects the run and routes back to the list", async () => {
    renderNav("m1");
    await waitFor(() =>
      expect(screen.getByTestId("measurement-selector")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("deselect-measurement-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe(
        "/operator-center/measurements",
      ),
    );
  });
});
