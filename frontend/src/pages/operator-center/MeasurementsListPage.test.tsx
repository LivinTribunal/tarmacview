import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { MeasurementListItem } from "@/types/measurement";
import MeasurementsListPage from "./MeasurementsListPage";
import { listMissionMeasurements } from "@/api/measurements";

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

const { navigateMock, missionHolder } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  missionHolder: { current: null as { id: string; name: string } | null },
}));

vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@/contexts/MissionContext", () => ({
  useMission: () => ({ selectedMission: missionHolder.current }),
}));

vi.mock("@/api/measurements", () => ({
  listMissionMeasurements: vi.fn(),
}));

// stub the heavy flow dialog - its own test covers the resume internals
vi.mock("@/components/mission/MeasurementFlowDialog", () => ({
  default: ({ resumeMeasurementId }: { resumeMeasurementId?: string }) => (
    <div data-testid="flow-dialog" data-resume={resumeMeasurementId} />
  ),
}));

const listMock = vi.mocked(listMissionMeasurements);

function row(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
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
    missionHolder.current = { id: "mission-1", name: "Demo Mission" };
    listMock.mockResolvedValue([]);
  });

  it("shows the no-mission-open state when no mission is selected", () => {
    missionHolder.current = null;
    render(<MeasurementsListPage />);
    expect(screen.getByTestId("measurements-no-mission")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("shows the empty state when the mission has no measurements", async () => {
    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-empty")).toBeInTheDocument(),
    );
    expect(listMock).toHaveBeenCalledWith("mission-1");
  });

  it("renders a row per measurement and routes each status", async () => {
    listMock.mockResolvedValue([
      row({ id: "done-1", status: "DONE", inspection_sequence_order: 1 }),
      row({
        id: "confirm-1",
        status: "AWAITING_CONFIRM",
        inspection_sequence_order: 2,
        has_results: false,
        pass_count: 0,
        fail_count: 0,
      }),
      row({
        id: "proc-1",
        status: "PROCESSING",
        inspection_sequence_order: 3,
        has_results: false,
      }),
      row({
        id: "err-1",
        status: "ERROR",
        inspection_sequence_order: 4,
        has_results: false,
        error_message: "processing failed: boom",
      }),
    ]);

    render(<MeasurementsListPage />);
    await waitFor(() =>
      expect(screen.getByTestId("measurements-list")).toBeInTheDocument(),
    );

    // DONE -> results page
    fireEvent.click(screen.getByTestId("view-results-done-1"));
    expect(navigateMock).toHaveBeenCalledWith(
      "/operator-center/measurements/done-1/results",
    );

    // AWAITING_CONFIRM -> resume the confirm step in the flow dialog
    fireEvent.click(screen.getByTestId("review-confirm-1"));
    const dialog = await screen.findByTestId("flow-dialog");
    expect(dialog).toHaveAttribute("data-resume", "confirm-1");

    // active run -> watch progress button present
    expect(screen.getByTestId("watch-proc-1")).toBeInTheDocument();

    // error row surfaces the failed status chip + the error message
    expect(screen.getByText(en.measurementsList.status.ERROR)).toBeInTheDocument();
    expect(screen.getByTestId("error-err-1")).toHaveTextContent(
      "processing failed: boom",
    );
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
      expect(screen.getByTestId("measurements-list")).toBeInTheDocument(),
    );
  });
});
