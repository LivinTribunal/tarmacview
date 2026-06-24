import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { DroneMediaListResponse } from "@/types/droneMedia";
import type { FieldLinkWaylineListResponse } from "@/types/fieldLink";
import FieldOpsPage from "./FieldOpsPage";
import {
  deleteWayline,
  getFieldLinkStatus,
  listWaylines,
} from "@/api/fieldLink";
import { listDroneMedia } from "@/api/droneMedia";

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

vi.mock("@/api/fieldLink", () => ({
  listWaylines: vi.fn(),
  deleteWayline: vi.fn(),
  getFieldLinkStatus: vi.fn(),
}));

vi.mock("@/api/droneMedia", () => ({
  listDroneMedia: vi.fn(),
}));

const listWaylinesMock = vi.mocked(listWaylines);
const deleteWaylineMock = vi.mocked(deleteWayline);
const statusMock = vi.mocked(getFieldLinkStatus);
const listMediaMock = vi.mocked(listDroneMedia);

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
    listWaylinesMock.mockResolvedValue(EMPTY_WAYLINES);
    statusMock.mockResolvedValue(onlineStatus());
    listMediaMock.mockResolvedValue(EMPTY_MEDIA);
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

  it("shows the hub-offline note when the hub is down", async () => {
    statusMock.mockResolvedValue({ ...onlineStatus(), hub_online: false });
    render(<FieldOpsPage />);
    await waitFor(() =>
      expect(screen.getByTestId("field-ops-hub-offline")).toBeInTheDocument(),
    );
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
});
