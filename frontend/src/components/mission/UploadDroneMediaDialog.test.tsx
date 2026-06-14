import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import en from "@/i18n/locales/en.json";
import UploadDroneMediaDialog from "./UploadDroneMediaDialog";
import {
  assignDroneMedia,
  confirmDroneMediaIngest,
  listDroneMedia,
} from "@/api/droneMedia";
import { listMissions } from "@/api/missions";
import type {
  DroneMediaFileResponse,
  DroneMediaListResponse,
} from "@/types/droneMedia";

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

// override the global react-i18next mock with one backed by the real en.json
// so assertions verify user-facing copy and prove the keys exist. t must be
// referentially stable - the dialog's fetch effect (correctly) depends on it.
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

vi.mock("@/api/droneMedia", () => ({
  listDroneMedia: vi.fn(),
  assignDroneMedia: vi.fn(),
  confirmDroneMediaIngest: vi.fn(),
}));

vi.mock("@/api/missions", () => ({
  listMissions: vi.fn(),
}));

function makeFile(
  overrides: Partial<DroneMediaFileResponse> = {},
): DroneMediaFileResponse {
  return {
    id: "file-1",
    object_key: "media/DJI_20260609142133_0001.JPG",
    fingerprint: "fp-1",
    captured_at: "2026-06-09T14:21:33+00:00",
    capture_position: { type: "Point", coordinates: [17.21, 48.17, 423.6] },
    device_sn: "1ZNBJ7R0010078",
    mission_id: "mission-1",
    status: "MATCHED",
    received_at: "2026-06-09T15:00:00+00:00",
    updated_at: "2026-06-09T15:00:00+00:00",
    ...overrides,
  };
}

const GROUPED: DroneMediaListResponse = {
  missions: [
    {
      mission_id: "mission-1",
      mission_name: "Runway 09 PAPI",
      files: [
        makeFile(),
        makeFile({ id: "file-2", fingerprint: "fp-2", object_key: "media/DJI_0002.JPG" }),
      ],
    },
  ],
  unassigned: [
    makeFile({
      id: "file-3",
      fingerprint: "fp-3",
      object_key: "media/DJI_0003.JPG",
      mission_id: null,
      status: "UNASSIGNED",
      captured_at: null,
    }),
  ],
};

const EMPTY: DroneMediaListResponse = { missions: [], unassigned: [] };

const MISSIONS = {
  data: [
    { id: "mission-1", name: "Runway 09 PAPI" },
    { id: "mission-2", name: "Runway 27 Edge Lights" },
  ],
  meta: { total: 2, limit: 100, offset: 0 },
};

function renderDialog() {
  return render(
    <UploadDroneMediaDialog isOpen onClose={vi.fn()} airportId="airport-1" />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDroneMedia).mockResolvedValue(GROUPED);
  vi.mocked(listMissions).mockResolvedValue(
    MISSIONS as Awaited<ReturnType<typeof listMissions>>,
  );
});

describe("UploadDroneMediaDialog", () => {
  it("renders mission groups with file counts and the unassigned bucket", async () => {
    renderDialog();

    const group = await screen.findByTestId("media-group-mission-1");
    expect(group.textContent).toContain("Runway 09 PAPI");
    expect(group.textContent).toContain("2 file(s)");
    expect(group.textContent).toContain("DJI_20260609142133_0001.JPG");
    expect(group.textContent).toContain("DJI_0002.JPG");

    const unassigned = screen.getByTestId("media-group-unassigned");
    expect(unassigned.textContent).toContain("Unassigned");
    expect(unassigned.textContent).toContain("1 file(s)");
    expect(unassigned.textContent).toContain("DJI_0003.JPG");
    expect(unassigned.textContent).toContain("No capture time");
  });

  it("does not fetch while closed", () => {
    render(
      <UploadDroneMediaDialog
        isOpen={false}
        onClose={vi.fn()}
        airportId="airport-1"
      />,
    );

    expect(listDroneMedia).not.toHaveBeenCalled();
  });

  it("reassigns a file to the selected mission and refetches", async () => {
    vi.mocked(assignDroneMedia).mockResolvedValue(
      makeFile({ id: "file-3", mission_id: "mission-2" }),
    );
    renderDialog();

    fireEvent.change(await screen.findByTestId("media-assign-file-3"), {
      target: { value: "mission-2" },
    });

    await waitFor(() =>
      expect(assignDroneMedia).toHaveBeenCalledWith("file-3", "mission-2"),
    );
    await waitFor(() => expect(listDroneMedia).toHaveBeenCalledTimes(2));
  });

  it("moves a file to the unassigned bucket via the empty option", async () => {
    vi.mocked(assignDroneMedia).mockResolvedValue(
      makeFile({ mission_id: null, status: "UNASSIGNED" }),
    );
    renderDialog();

    fireEvent.change(await screen.findByTestId("media-assign-file-1"), {
      target: { value: "" },
    });

    await waitFor(() =>
      expect(assignDroneMedia).toHaveBeenCalledWith("file-1", null),
    );
  });

  it("confirms a mission group into the pipeline and refetches", async () => {
    vi.mocked(confirmDroneMediaIngest).mockResolvedValue({
      mission_id: "mission-1",
      ingested_count: 2,
    });
    renderDialog();

    fireEvent.click(await screen.findByTestId("media-confirm-mission-1"));

    await waitFor(() =>
      expect(confirmDroneMediaIngest).toHaveBeenCalledWith("mission-1"),
    );
    await waitFor(() => expect(listDroneMedia).toHaveBeenCalledTimes(2));
  });

  it("shows the empty state when nothing was received", async () => {
    vi.mocked(listDroneMedia).mockResolvedValue(EMPTY);
    renderDialog();

    expect(
      await screen.findByText(
        "No drone media received yet. Upload media from DJI Pilot 2 after landing.",
      ),
    ).toBeInTheDocument();
  });

  it("surfaces a load error", async () => {
    vi.mocked(listDroneMedia).mockRejectedValue(new Error("boom"));
    renderDialog();

    expect(
      await screen.findByText("Failed to load drone media"),
    ).toBeInTheDocument();
  });
});
