import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { DroneMediaListResponse } from "@/types/droneMedia";
import type { FieldLinkWaylineListResponse } from "@/types/fieldLink";
import type { MissionDetailResponse, MissionResponse } from "@/types/mission";
import FieldOpsPage from "./FieldOpsPage";
import {
  deleteWayline,
  getFieldLinkStatus,
  listWaylines,
} from "@/api/fieldLink";
import {
  assignDroneMedia,
  getDroneMediaViewUrl,
  listDroneMedia,
  moveDroneMedia,
} from "@/api/droneMedia";
import { getMission, listMissions } from "@/api/missions";
import { createMeasurement } from "@/api/measurements";

const { airportHolder } = vi.hoisted(() => ({
  airportHolder: { current: null as { id: string; name: string } | null },
}));

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

vi.mock("react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: unknown }) => (
    <a href={to} {...rest}>
      {children as never}
    </a>
  ),
}));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: airportHolder.current }),
}));

vi.mock("@/api/fieldLink", () => ({
  listWaylines: vi.fn(),
  deleteWayline: vi.fn(),
  getFieldLinkStatus: vi.fn(),
  downloadCaCert: vi.fn(),
}));

vi.mock("@/api/droneMedia", () => ({
  listDroneMedia: vi.fn(),
  getDroneMediaViewUrl: vi.fn(),
  assignDroneMedia: vi.fn(),
  moveDroneMedia: vi.fn(),
}));

vi.mock("@/api/missions", () => ({
  listMissions: vi.fn(),
  getMission: vi.fn(),
}));

vi.mock("@/api/measurements", () => ({
  createMeasurement: vi.fn(),
}));

const listWaylinesMock = vi.mocked(listWaylines);
const deleteWaylineMock = vi.mocked(deleteWayline);
const statusMock = vi.mocked(getFieldLinkStatus);
const listMediaMock = vi.mocked(listDroneMedia);
const viewUrlMock = vi.mocked(getDroneMediaViewUrl);
const assignMock = vi.mocked(assignDroneMedia);
const moveMock = vi.mocked(moveDroneMedia);
const listMissionsMock = vi.mocked(listMissions);
const getMissionMock = vi.mocked(getMission);
const createMeasurementMock = vi.mocked(createMeasurement);

/** one mission-grouped media row, for the open-media tests. */
const ONE_MEDIA_ROW: DroneMediaListResponse = {
  missions: [
    {
      mission_id: "m1",
      mission_name: "Demo Mission",
      files: [
        {
          id: "f1",
          object_key: "media/clip.mp4",
          fingerprint: null,
          captured_at: "2026-06-01T10:00:00Z",
          capture_position: null,
          device_sn: null,
          mission_id: "m1",
          inspection_id: null,
          order_index: null,
          origin: "HUB",
          filename: "clip.mp4",
          size_bytes: 2048,
          status: "MATCHED",
          received_at: "2026-06-01T10:01:00Z",
          updated_at: "2026-06-01T10:01:00Z",
        },
      ],
    },
  ],
  unassigned: [],
};

function onlineStatus() {
  return {
    hub_online: true,
    rc_connected: false,
    broker_connected: false,
    devices: [],
    connect_url: null,
    public_host: null,
  };
}

const EMPTY_MEDIA: DroneMediaListResponse = { missions: [], unassigned: [] };
const EMPTY_WAYLINES: FieldLinkWaylineListResponse = { waylines: [] };

describe("FieldOpsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    airportHolder.current = { id: "ap1", name: "Demo Airport" };
    listWaylinesMock.mockResolvedValue(EMPTY_WAYLINES);
    statusMock.mockResolvedValue(onlineStatus());
    listMediaMock.mockResolvedValue(EMPTY_MEDIA);
    listMissionsMock.mockResolvedValue({
      data: [],
      meta: { total: 0, limit: 50, offset: 0 },
    });
  });

  it("renders empty states for both tables", async () => {
    render(<FieldOpsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("field-ops-waylines-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("field-ops-media-empty")).toBeInTheDocument();
  });

  it("renders wayline and media rows", async () => {
    listWaylinesMock.mockResolvedValue({
      waylines: [
        {
          id: "w1",
          mission_id: "m1",
          name: "Alpha Wayline",
          drone_model_key: "M30T",
          payload_model_keys: [],
          favorited: false,
          username: "op",
          create_time: 1_700_000_000_000,
          update_time: 1_700_000_500_000,
        },
      ],
    });
    listMediaMock.mockResolvedValue({
      missions: [
        {
          mission_id: "m1",
          mission_name: "Demo Mission",
          files: [
            {
              id: "f1",
              object_key: "media/f1.jpg",
              fingerprint: null,
              captured_at: "2026-06-01T10:00:00Z",
              capture_position: null,
              device_sn: null,
              mission_id: "m1",
              inspection_id: null,
              order_index: null,
              origin: "HUB",
              filename: "photo.jpg",
              size_bytes: 2048,
              status: "MATCHED",
              received_at: "2026-06-01T10:01:00Z",
              updated_at: "2026-06-01T10:01:00Z",
            },
          ],
        },
      ],
      unassigned: [
        {
          id: "f2",
          object_key: "media/f2.jpg",
          fingerprint: null,
          captured_at: null,
          capture_position: null,
          device_sn: null,
          mission_id: null,
          inspection_id: null,
          order_index: null,
          origin: "HUB",
          filename: null,
          size_bytes: null,
          status: "UNASSIGNED",
          received_at: "2026-06-01T10:02:00Z",
          updated_at: "2026-06-01T10:02:00Z",
        },
      ],
    });

    render(<FieldOpsPage />);

    const waylinesTable = await screen.findByTestId("field-ops-waylines-table");
    expect(within(waylinesTable).getByText("Alpha Wayline")).toBeInTheDocument();
    expect(within(waylinesTable).getByText("M30T")).toBeInTheDocument();

    const mediaTable = screen.getByTestId("field-ops-media-table");
    expect(within(mediaTable).getByText("photo.jpg")).toBeInTheDocument();
    // unassigned file with no filename falls back to its object key
    expect(within(mediaTable).getByText("media/f2.jpg")).toBeInTheDocument();
    expect(within(mediaTable).getByText("Demo Mission")).toBeInTheDocument();
  });

  it("deletes a wayline through the confirm modal and refetches", async () => {
    listWaylinesMock.mockResolvedValue({
      waylines: [
        {
          id: "w1",
          mission_id: "m1",
          name: "Alpha Wayline",
          drone_model_key: null,
          payload_model_keys: [],
          favorited: false,
          username: null,
          create_time: 1,
          update_time: 1,
        },
      ],
    });
    deleteWaylineMock.mockResolvedValue(undefined);

    render(<FieldOpsPage />);
    await screen.findByTestId("field-ops-waylines-table");
    expect(listWaylinesMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("field-ops-wayline-delete-w1"));
    fireEvent.click(screen.getByTestId("field-ops-confirm-delete"));

    await waitFor(() => expect(deleteWaylineMock).toHaveBeenCalledWith("w1"));
    // list refetches after a successful delete
    await waitFor(() => expect(listWaylinesMock).toHaveBeenCalledTimes(2));
  });

  it("opens a media file in a new tab via a presigned url", async () => {
    listMediaMock.mockResolvedValue(ONE_MEDIA_ROW);
    viewUrlMock.mockResolvedValue("https://minio.test/media/clip.mp4?sig=abc");
    const fakeWin = { opener: {}, location: { href: "" }, close: vi.fn() };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(fakeWin as unknown as Window);

    render(<FieldOpsPage />);
    const openBtn = await screen.findByTestId("field-ops-media-open-f1");
    fireEvent.click(openBtn);

    await waitFor(() => expect(viewUrlMock).toHaveBeenCalledWith("f1"));
    await waitFor(() =>
      expect(fakeWin.location.href).toBe("https://minio.test/media/clip.mp4?sig=abc"),
    );
    expect(fakeWin.opener).toBeNull();
    openSpy.mockRestore();
  });

  it("surfaces an open error when the presign request fails", async () => {
    listMediaMock.mockResolvedValue(ONE_MEDIA_ROW);
    viewUrlMock.mockRejectedValueOnce(new Error("boom"));
    const fakeWin = { opener: {}, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(fakeWin as unknown as Window);

    render(<FieldOpsPage />);
    const openBtn = await screen.findByTestId("field-ops-media-open-f1");
    fireEvent.click(openBtn);

    await waitFor(() =>
      expect(screen.getByTestId("field-ops-media-open-error")).toBeInTheDocument(),
    );
    expect(fakeWin.close).toHaveBeenCalled();
  });

  it("renders the Field Hub connection panel in the left column", async () => {
    render(<FieldOpsPage />);
    const card = await screen.findByTestId("field-ops-hub-card");
    expect(within(card).getByTestId("field-hub-heartbeat")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(card).getByTestId("field-hub-hub")).toHaveAttribute("data-online", "true"),
    );
  });

  it("shows the hub-offline state in the left panel when the hub is down", async () => {
    statusMock.mockResolvedValue({ ...onlineStatus(), hub_online: false });
    render(<FieldOpsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("field-hub-offline")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("field-hub-hub")).toHaveAttribute("data-online", "false");
  });

  it("surfaces a load error with retry for cloud missions", async () => {
    listWaylinesMock.mockRejectedValueOnce(new Error("boom"));
    render(<FieldOpsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("field-ops-waylines-error")).toBeInTheDocument(),
    );

    listWaylinesMock.mockResolvedValueOnce(EMPTY_WAYLINES);
    statusMock.mockResolvedValueOnce(onlineStatus());
    fireEvent.click(within(screen.getByTestId("field-ops-waylines-error")).getByText(en.common.retry));
    await waitFor(() =>
      expect(screen.getByTestId("field-ops-waylines-empty")).toBeInTheDocument(),
    );
  });

  it("links a video to an inspection and starts a measurement in order", async () => {
    listMediaMock.mockResolvedValue(ONE_MEDIA_ROW);
    listMissionsMock.mockResolvedValue({
      data: [{ id: "m1", name: "Demo Mission" } as MissionResponse],
      meta: { total: 1, limit: 50, offset: 0 },
    });
    getMissionMock.mockResolvedValue({
      id: "m1",
      name: "Demo Mission",
      inspections: [
        { id: "ins1", method: "VERTICAL_PROFILE", sequence_order: 1 },
        { id: "ins2", method: "FLY_OVER", sequence_order: 2 },
      ],
    } as MissionDetailResponse);
    assignMock.mockResolvedValue({ id: "f1" } as never);
    moveMock.mockResolvedValue({ id: "f1" } as never);
    createMeasurementMock.mockResolvedValue({ id: "meas1" } as never);

    render(<FieldOpsPage />);
    // the row's mission is pre-selected, so inspections load on open
    fireEvent.click(await screen.findByTestId("field-ops-link-toggle-f1"));
    await waitFor(() => expect(getMissionMock).toHaveBeenCalledWith("m1"));

    fireEvent.change(screen.getByTestId("field-ops-link-inspection-f1"), {
      target: { value: "ins2" },
    });

    // a fresh load count baseline so we can assert the post-success refetch
    const mediaCallsBefore = listMediaMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("field-ops-link-confirm-f1"));

    await waitFor(() =>
      expect(screen.getByTestId("field-ops-link-success-f1")).toBeInTheDocument(),
    );

    // assign is skipped: the row already carries the selected mission id
    expect(assignMock).not.toHaveBeenCalled();
    expect(moveMock).toHaveBeenCalledWith("f1", "ins2", null);
    expect(createMeasurementMock).toHaveBeenCalledWith("ins2");

    // ordering: move resolves before createMeasurement is invoked
    expect(moveMock.mock.invocationCallOrder[0]).toBeLessThan(
      createMeasurementMock.mock.invocationCallOrder[0],
    );

    // media list refetches after success
    await waitFor(() =>
      expect(listMediaMock.mock.calls.length).toBeGreaterThan(mediaCallsBefore),
    );

    // a results link is surfaced for the started run
    expect(screen.getByTestId("field-ops-link-results-f1")).toHaveAttribute(
      "href",
      "/operator-center/measurements/meas1/results",
    );
  });

  it("assigns before moving when the row has no mission yet", async () => {
    listMediaMock.mockResolvedValue({
      missions: [],
      unassigned: [
        {
          id: "u1",
          object_key: "media/u1.mp4",
          fingerprint: null,
          captured_at: null,
          capture_position: null,
          device_sn: null,
          mission_id: null,
          inspection_id: null,
          order_index: null,
          origin: "HUB",
          filename: "u1.mp4",
          size_bytes: 1024,
          status: "UNASSIGNED",
          received_at: "2026-06-01T10:02:00Z",
          updated_at: "2026-06-01T10:02:00Z",
        },
      ],
    });
    listMissionsMock.mockResolvedValue({
      data: [{ id: "m9", name: "Pick Me" } as MissionResponse],
      meta: { total: 1, limit: 50, offset: 0 },
    });
    // one inspection: auto-selected on mission pick
    getMissionMock.mockResolvedValue({
      id: "m9",
      name: "Pick Me",
      inspections: [{ id: "only1", method: "HOVER_POINT_LOCK", sequence_order: 1 }],
    } as MissionDetailResponse);
    assignMock.mockResolvedValue({ id: "u1" } as never);
    moveMock.mockResolvedValue({ id: "u1" } as never);
    createMeasurementMock.mockResolvedValue({ id: "meas9" } as never);

    render(<FieldOpsPage />);
    fireEvent.click(await screen.findByTestId("field-ops-link-toggle-u1"));

    fireEvent.change(screen.getByTestId("field-ops-link-mission-u1"), {
      target: { value: "m9" },
    });
    await waitFor(() => expect(getMissionMock).toHaveBeenCalledWith("m9"));

    fireEvent.click(screen.getByTestId("field-ops-link-confirm-u1"));

    await waitFor(() =>
      expect(screen.getByTestId("field-ops-link-success-u1")).toBeInTheDocument(),
    );

    // assign runs first because the row had no mission_id
    expect(assignMock).toHaveBeenCalledWith("u1", "m9");
    expect(assignMock.mock.invocationCallOrder[0]).toBeLessThan(
      moveMock.mock.invocationCallOrder[0],
    );
    expect(moveMock).toHaveBeenCalledWith("u1", "only1", null);
    expect(createMeasurementMock).toHaveBeenCalledWith("only1");
  });

  it("prompts to select an airport when none is active", async () => {
    airportHolder.current = null;
    listMediaMock.mockResolvedValue(ONE_MEDIA_ROW);

    render(<FieldOpsPage />);
    fireEvent.click(await screen.findByTestId("field-ops-link-toggle-f1"));

    expect(screen.getByTestId("field-ops-link-no-airport-f1")).toBeInTheDocument();
  });
});
