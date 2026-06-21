import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UploadIterationDialog from "./UploadIterationDialog";
import { requestUploadUrl, uploadToPresignedUrl } from "@/api/droneMedia";
import { iterateMeasurement } from "@/api/measurements";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const navigateMock = vi.fn();
vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

const trackMock = vi.fn();
vi.mock("@/contexts/MeasurementProgressContext", () => ({
  useMeasurementProgress: () => ({ track: trackMock }),
}));

vi.mock("@/api/droneMedia", () => ({
  requestUploadUrl: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
}));

vi.mock("@/api/measurements", () => ({
  iterateMeasurement: vi.fn(),
}));

const requestUrlMock = vi.mocked(requestUploadUrl);
const uploadMock = vi.mocked(uploadToPresignedUrl);
const iterateMock = vi.mocked(iterateMeasurement);

function fileList(...files: File[]) {
  return files;
}

describe("UploadIterationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestUrlMock.mockImplementation(async (filename: string) => ({
      object_key: `key/${filename}`,
      upload_url: `https://put/${filename}`,
    }));
    uploadMock.mockResolvedValue(undefined);
    iterateMock.mockResolvedValue({
      id: "new-run",
      inspection_id: "i1",
      status: "QUEUED",
      label: null,
      iteration_group_id: "g1",
      iteration_index: 2,
      error_message: null,
    });
  });

  it("uploads each file, starts the iteration, tracks it, and navigates to compare", async () => {
    render(<UploadIterationDialog measurementId="m1" onClose={vi.fn()} />);

    const input = screen.getByTestId("iteration-file-input");
    const a = new File(["a"], "a.mp4", { type: "video/mp4" });
    const b = new File(["b"], "b.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: fileList(a, b) } });

    fireEvent.click(screen.getByTestId("confirm-iteration-upload"));

    await waitFor(() => expect(iterateMock).toHaveBeenCalled());

    // a presigned PUT per file, in order
    expect(requestUrlMock).toHaveBeenCalledTimes(2);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    // the iteration is started with the collected object keys
    expect(iterateMock).toHaveBeenCalledWith("m1", ["key/a.mp4", "key/b.mp4"]);
    // the new run is tracked in the progress toast and we land on its compare view
    expect(trackMock).toHaveBeenCalledWith(["new-run"]);
    expect(navigateMock).toHaveBeenCalledWith(
      "/operator-center/measurements/new-run/results/compare",
    );
  });

  it("disables confirm until at least one file is selected", () => {
    render(<UploadIterationDialog measurementId="m1" onClose={vi.fn()} />);
    expect(screen.getByTestId("confirm-iteration-upload")).toBeDisabled();
  });
});
