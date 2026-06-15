import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import UploadDroneMediaDialog from "./UploadDroneMediaDialog";
import {
  completeDroneMediaUpload,
  deleteDroneMedia,
  listMissionDroneMedia,
  moveDroneMedia,
  reorderInspectionMedia,
  requestUploadUrl,
  uploadToPresignedUrl,
} from "@/api/droneMedia";
import { createMeasurement } from "@/api/measurements";
import type {
  DroneMediaFileResponse,
  MissionInspectionMediaResponse,
} from "@/types/droneMedia";
import type { Measurement } from "@/types/measurement";

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

const stableT = (key: string, opts?: Record<string, unknown>) => {
  let value = resolveKey(key);
  for (const [k, v] of Object.entries(opts ?? {})) {
    value = value.replace(`{{${k}}}`, String(v));
  }
  return value;
};
const stableI18n = {
  language: "en",
  changeLanguage: vi.fn(),
  options: { resources: { en: {} } },
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// capture the DndContext handler so tests can drive drag events directly -
// real @dnd-kit pointer dragging isn't reproducible in jsdom
let capturedDragEnd: ((event: unknown) => void) | null = null;

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: unknown) => void;
  }) => {
    capturedDragEnd = onDragEnd;
    return <div data-testid="dnd-context">{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const copy = arr.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  },
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

vi.mock("@/api/droneMedia", () => ({
  listMissionDroneMedia: vi.fn(),
  requestUploadUrl: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
  completeDroneMediaUpload: vi.fn(),
  moveDroneMedia: vi.fn(),
  reorderInspectionMedia: vi.fn(),
  deleteDroneMedia: vi.fn(),
}));

vi.mock("@/api/measurements", () => ({ createMeasurement: vi.fn() }));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router", () => ({ useNavigate: () => navigateMock }));

function makeFile(
  overrides: Partial<DroneMediaFileResponse> = {},
): DroneMediaFileResponse {
  return {
    id: "file-1",
    object_key: "drone-media/manual/x/clip.mp4",
    fingerprint: null,
    captured_at: null,
    capture_position: null,
    device_sn: null,
    mission_id: "mission-1",
    inspection_id: "insp-1",
    order_index: 1,
    origin: "MANUAL",
    filename: "clip.mp4",
    size_bytes: 2048,
    status: "MATCHED",
    received_at: "2026-06-14T15:00:00+00:00",
    updated_at: "2026-06-14T15:00:00+00:00",
    ...overrides,
  };
}

function measurement(id: string): Measurement {
  return { id, inspection_id: "insp-1", status: "QUEUED", label: null, error_message: null };
}

const MEDIA: MissionInspectionMediaResponse = {
  mission_id: "mission-1",
  mission_name: "Runway 09 PAPI",
  inspections: [
    {
      inspection_id: "insp-1",
      method: "HORIZONTAL_RANGE",
      sequence_order: 1,
      files: [
        makeFile({ id: "a1", order_index: 1, filename: "a1.mp4" }),
        makeFile({ id: "a2", order_index: 2, filename: "a2.mp4" }),
      ],
    },
    {
      inspection_id: "insp-2",
      method: "VERTICAL_PROFILE",
      sequence_order: 2,
      files: [makeFile({ id: "b1", inspection_id: "insp-2", order_index: 1, filename: "b1.mp4" })],
    },
  ],
  unassigned: [
    makeFile({
      id: "u1",
      filename: "u1.mp4",
      inspection_id: null,
      order_index: null,
    }),
  ],
};

function renderDialog() {
  return render(
    <UploadDroneMediaDialog isOpen onClose={vi.fn()} missionId="mission-1" />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedDragEnd = null;
  vi.mocked(listMissionDroneMedia).mockResolvedValue(MEDIA);
});

describe("UploadDroneMediaDialog", () => {
  it("renders inspection groups with labels, counts, files, and the unassigned bucket", async () => {
    renderDialog();

    const groupA = await screen.findByTestId("media-group-insp-1");
    expect(groupA.textContent).toContain("Inspection 1 · HORIZONTAL_RANGE");
    expect(groupA.textContent).toContain("2 file(s)");
    expect(groupA.textContent).toContain("a1.mp4");
    expect(groupA.textContent).toContain("a2.mp4");

    const groupB = screen.getByTestId("media-group-insp-2");
    expect(groupB.textContent).toContain("Inspection 2 · VERTICAL_PROFILE");
    expect(groupB.textContent).toContain("b1.mp4");

    const unassigned = screen.getByTestId("media-group-unassigned");
    expect(unassigned.textContent).toContain("Unassigned");
    expect(unassigned.textContent).toContain("u1.mp4");
  });

  it("does not fetch while closed", () => {
    render(
      <UploadDroneMediaDialog isOpen={false} onClose={vi.fn()} missionId="mission-1" />,
    );
    expect(listMissionDroneMedia).not.toHaveBeenCalled();
  });

  it("uploads a dropped file via upload-url -> PUT -> complete-upload", async () => {
    vi.mocked(requestUploadUrl).mockResolvedValue({
      object_key: "drone-media/manual/abc/clip.mp4",
      upload_url: "https://minio/put-target",
    });
    vi.mocked(uploadToPresignedUrl).mockResolvedValue(undefined);
    vi.mocked(completeDroneMediaUpload).mockResolvedValue(makeFile({ id: "new" }));
    renderDialog();

    const input = await screen.findByTestId("media-upload-input-insp-1");
    const file = new File(["data"], "clip.mp4", { type: "video/mp4" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(requestUploadUrl).toHaveBeenCalledWith("clip.mp4", "video/mp4"),
    );
    expect(uploadToPresignedUrl).toHaveBeenCalledWith("https://minio/put-target", file);
    expect(completeDroneMediaUpload).toHaveBeenCalledWith({
      missionId: "mission-1",
      inspectionId: "insp-1",
      objectKey: "drone-media/manual/abc/clip.mp4",
      filename: "clip.mp4",
      sizeBytes: file.size,
    });
    // initial load + refetch after upload
    await waitFor(() => expect(listMissionDroneMedia).toHaveBeenCalledTimes(2));
  });

  it("reorders within an inspection on a same-group drag", async () => {
    vi.mocked(reorderInspectionMedia).mockResolvedValue(MEDIA.inspections[0]);
    renderDialog();
    await screen.findByTestId("media-group-insp-1");

    await act(async () => {
      await capturedDragEnd!({ active: { id: "a1" }, over: { id: "a2" } });
    });

    expect(reorderInspectionMedia).toHaveBeenCalledWith("insp-1", ["a2", "a1"]);
    expect(moveDroneMedia).not.toHaveBeenCalled();
  });

  it("moves a file when dragged onto another inspection", async () => {
    vi.mocked(moveDroneMedia).mockResolvedValue(makeFile({ id: "a1", inspection_id: "insp-2" }));
    renderDialog();
    await screen.findByTestId("media-group-insp-1");

    await act(async () => {
      await capturedDragEnd!({ active: { id: "a1" }, over: { id: "inspection:insp-2" } });
    });

    // appended after b1 (the lone existing file) -> order 2
    expect(moveDroneMedia).toHaveBeenCalledWith("a1", "insp-2", 2);
    expect(reorderInspectionMedia).not.toHaveBeenCalled();
  });

  it("deletes a manual file when its trash button is clicked", async () => {
    vi.mocked(deleteDroneMedia).mockResolvedValue(undefined);
    renderDialog();
    await screen.findByTestId("media-group-insp-1");

    await act(async () => {
      fireEvent.click(screen.getByTestId("media-delete-a1"));
    });

    expect(deleteDroneMedia).toHaveBeenCalledWith("a1");
    // initial load + reconcile refetch after the delete
    await waitFor(() => expect(listMissionDroneMedia).toHaveBeenCalledTimes(2));
  });

  it("only manual files expose a delete button", async () => {
    vi.mocked(listMissionDroneMedia).mockResolvedValue({
      ...MEDIA,
      inspections: [
        {
          inspection_id: "insp-1",
          method: "HORIZONTAL_RANGE",
          sequence_order: 1,
          files: [
            makeFile({ id: "manual1", origin: "MANUAL" }),
            makeFile({ id: "hub1", origin: "HUB" }),
          ],
        },
      ],
    });
    renderDialog();
    await screen.findByTestId("media-file-hub1");

    expect(screen.getByTestId("media-delete-manual1")).toBeInTheDocument();
    expect(screen.queryByTestId("media-delete-hub1")).not.toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    vi.mocked(listMissionDroneMedia).mockRejectedValue(new Error("boom"));
    renderDialog();

    expect(
      await screen.findByText("Failed to load drone media"),
    ).toBeInTheDocument();
  });

  it("fires one measurement per inspection with media on 'Measure all'", async () => {
    vi.mocked(createMeasurement).mockResolvedValue(measurement("m1"));
    renderDialog();
    const button = await screen.findByTestId("measure-all");

    await act(async () => {
      fireEvent.click(button);
    });

    // insp-1 and insp-2 hold media; the unassigned bucket is skipped
    await waitFor(() => expect(createMeasurement).toHaveBeenCalledTimes(2));
    expect(createMeasurement).toHaveBeenCalledWith("insp-1");
    expect(createMeasurement).toHaveBeenCalledWith("insp-2");
    expect(
      await screen.findByText("2 started — review in Results"),
    ).toBeInTheDocument();
  });

  it("disables 'Measure all' when no inspection has media", async () => {
    vi.mocked(listMissionDroneMedia).mockResolvedValue({
      ...MEDIA,
      inspections: [
        {
          inspection_id: "insp-1",
          method: "HORIZONTAL_RANGE",
          sequence_order: 1,
          files: [],
        },
      ],
      unassigned: [makeFile({ id: "u1", inspection_id: null, order_index: null })],
    });
    renderDialog();

    const button = await screen.findByTestId("measure-all");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createMeasurement).not.toHaveBeenCalled();
  });

  it("surfaces partial failure without aborting the batch", async () => {
    vi.mocked(createMeasurement).mockImplementation((id) =>
      id === "insp-2"
        ? Promise.reject(new Error("worker down"))
        : Promise.resolve(measurement("m1")),
    );
    renderDialog();
    const button = await screen.findByTestId("measure-all");

    await act(async () => {
      fireEvent.click(button);
    });

    // one bad inspection must not block the other - both are attempted
    await waitFor(() => expect(createMeasurement).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText("1 of 2 started, 1 failed — review in Results"),
    ).toBeInTheDocument();
  });

  it("navigates to the measurements list from 'review in Results'", async () => {
    vi.mocked(createMeasurement).mockResolvedValue(measurement("m1"));
    renderDialog();
    const button = await screen.findByTestId("measure-all");

    await act(async () => {
      fireEvent.click(button);
    });

    fireEvent.click(await screen.findByTestId("review-in-results"));
    expect(navigateMock).toHaveBeenCalledWith("/operator-center/measurements");
  });
});
