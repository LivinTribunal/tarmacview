import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import MeasurementFlowDialog from "./MeasurementFlowDialog";
import {
  confirmMeasurementLights,
  createMeasurement,
  getMeasurementPreview,
  getMeasurementStatus,
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

const stableT = (key: string) => resolveKey(key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@/api/client", () => ({ isAxiosError: () => false }));

vi.mock("@/api/measurements", () => ({
  createMeasurement: vi.fn(),
  getMeasurementStatus: vi.fn(),
  getMeasurementPreview: vi.fn(),
  confirmMeasurementLights: vi.fn(),
}));

const createMock = vi.mocked(createMeasurement);
const statusMock = vi.mocked(getMeasurementStatus);
const previewMock = vi.mocked(getMeasurementPreview);
const confirmMock = vi.mocked(confirmMeasurementLights);

/** flush pending promise jobs (no timer advance). */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** advance past one poll interval, flushing the chained async work. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

function renderDialog() {
  return render(
    <MeasurementFlowDialog
      inspectionId="insp-1"
      inspectionLabel="Inspection 1 · HORIZONTAL_RANGE"
      onClose={vi.fn()}
    />,
  );
}

describe("MeasurementFlowDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    statusMock.mockResolvedValue({ id: "m1", status: "QUEUED", error_message: null });
  });

  it("surfaces an error when the run can't start", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    await flush();

    expect(screen.getByText(en.mission.measurementFlow.startError)).toBeInTheDocument();
    expect(createMock).toHaveBeenCalledWith("insp-1");
    vi.useRealTimers();
  });

  it("runs start -> confirm -> process -> view results", async () => {
    createMock.mockResolvedValueOnce({
      id: "m1",
      inspection_id: "insp-1",
      status: "QUEUED",
      label: null,
      error_message: null,
    });
    confirmMock.mockResolvedValueOnce({
      id: "m1",
      inspection_id: "insp-1",
      status: "PROCESSING",
      label: null,
      error_message: null,
    });
    previewMock.mockResolvedValueOnce({
      id: "m1",
      status: "AWAITING_CONFIRM",
      first_frame_url: "http://localhost:9000/frame.jpg",
      boxes: [{ light_name: "PAPI_A", x: 50, y: 50, size: 8 }],
    });

    renderDialog();
    await flush();
    expect(screen.getByText(en.mission.measurementFlow.phase.queued)).toBeInTheDocument();

    // first poll lands on AWAITING_CONFIRM, then the preview loads the confirm UI
    statusMock.mockResolvedValueOnce({
      id: "m1",
      status: "AWAITING_CONFIRM",
      error_message: null,
    });
    await tick();
    await flush();

    expect(screen.getByTestId("light-box-PAPI_A")).toBeInTheDocument();
    const confirmBtn = screen.getByTestId("confirm-lights-button");

    fireEvent.click(confirmBtn);
    await flush();
    expect(confirmMock).toHaveBeenCalledWith("m1", [
      { light_name: "PAPI_A", x: 50, y: 50, size: 8 },
    ]);

    // processing poll lands on DONE -> view-results appears
    statusMock.mockResolvedValueOnce({ id: "m1", status: "DONE", error_message: null });
    await tick();

    const viewBtn = screen.getByTestId("view-results-button");
    fireEvent.click(viewBtn);
    expect(navigateMock).toHaveBeenCalledWith("/operator-center/measurements/m1/results");
    vi.useRealTimers();
  });

  it("resumes an existing run at the confirm step without creating one", async () => {
    statusMock.mockResolvedValueOnce({
      id: "m9",
      status: "AWAITING_CONFIRM",
      error_message: null,
    });
    previewMock.mockResolvedValueOnce({
      id: "m9",
      status: "AWAITING_CONFIRM",
      first_frame_url: "http://localhost:9000/frame.jpg",
      boxes: [{ light_name: "PAPI_A", x: 50, y: 50, size: 8 }],
    });

    render(
      <MeasurementFlowDialog
        inspectionId="insp-1"
        inspectionLabel="Inspection 1 · HORIZONTAL_RANGE"
        resumeMeasurementId="m9"
        onClose={vi.fn()}
      />,
    );
    // status fetch resolves -> AWAITING_CONFIRM, then the preview loads the confirm UI
    await flush();
    await flush();

    expect(createMock).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith("m9");
    expect(screen.getByTestId("light-box-PAPI_A")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
