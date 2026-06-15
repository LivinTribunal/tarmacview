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

const BOX = { light_name: "PAPI_A", x: 50, y: 50, size: 8 };

/** flush pending promise jobs (no timer advance). */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function renderDialog(onClose: () => void = vi.fn()) {
  return render(
    <MeasurementFlowDialog
      measurementId="m9"
      inspectionLabel="Inspection 1 · HORIZONTAL_RANGE"
      onClose={onClose}
    />,
  );
}

/** seed the status + preview for a run waiting on confirmation. */
function seedAwaitingConfirm() {
  statusMock.mockResolvedValue({ id: "m9", status: "AWAITING_CONFIRM", error_message: null });
  previewMock.mockResolvedValue({
    id: "m9",
    status: "AWAITING_CONFIRM",
    first_frame_url: "http://localhost:9000/frame.jpg",
    boxes: [BOX],
  });
}

describe("MeasurementFlowDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("opens at the confirm step from measurementId without creating a run", async () => {
    seedAwaitingConfirm();
    renderDialog();
    // status seed resolves -> AWAITING_CONFIRM, then the preview loads the confirm UI
    await flush();
    await flush();

    expect(createMock).not.toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith("m9");
    expect(screen.getByTestId("light-box-PAPI_A")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("confirms the boxes and closes the dialog", async () => {
    seedAwaitingConfirm();
    confirmMock.mockResolvedValueOnce({
      id: "m9",
      inspection_id: "insp-1",
      status: "PROCESSING",
      error_message: null,
    });
    const onClose = vi.fn();
    renderDialog(onClose);
    await flush();
    await flush();

    fireEvent.click(screen.getByTestId("confirm-lights-button"));
    await flush();

    expect(confirmMock).toHaveBeenCalledWith("m9", [BOX]);
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not poll for status after the initial seed", async () => {
    seedAwaitingConfirm();
    renderDialog();
    await flush();
    await flush();
    expect(statusMock).toHaveBeenCalledTimes(1);

    // there is no status-watch poll - advancing the clock fetches nothing more
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("surfaces an error when the run can't be loaded", async () => {
    statusMock.mockRejectedValueOnce(new Error("boom"));
    renderDialog();
    await flush();

    expect(
      screen.getByText(en.mission.measurementFlow.previewError),
    ).toBeInTheDocument();
    vi.useRealTimers();
  });
});
