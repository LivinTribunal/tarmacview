import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CameraPresetsPanel from "./CameraPresetsPanel";
import type { CameraPresetResponse } from "@/types/cameraPreset";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const { mockList, mockCreate, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(() => Promise.resolve({})),
  mockUpdate: vi.fn(() => Promise.resolve({})),
  mockDelete: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/api/cameraPresets", () => ({
  listCameraPresets: mockList,
  createCameraPreset: mockCreate,
  updateCameraPreset: mockUpdate,
  deleteCameraPreset: mockDelete,
}));

const preset: CameraPresetResponse = {
  id: "p1",
  name: "Bright",
  drone_profile_id: "drone-1",
  created_by: null,
  is_default: false,
  white_balance: "CLOUDY",
  iso: 800,
  shutter_speed: "1/250",
  focus_mode: "AUTO",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

describe("CameraPresetsPanel", () => {
  beforeEach(() => {
    mockList.mockReset().mockResolvedValue({ data: [] });
    mockCreate.mockClear();
    mockUpdate.mockClear();
    mockDelete.mockClear();
  });

  it("sends a byte-identical create payload", async () => {
    render(<CameraPresetsPanel droneId="drone-1" />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("add-preset-btn"));
    fireEvent.change(screen.getByTestId("new-preset-name"), {
      target: { value: "My Preset" },
    });
    fireEvent.change(screen.getByTestId("new-preset-white-balance"), {
      target: { value: "DAYLIGHT" },
    });
    fireEvent.change(screen.getByTestId("new-preset-iso"), {
      target: { value: "400" },
    });
    fireEvent.change(screen.getByTestId("new-preset-shutter-speed"), {
      target: { value: "1/500" },
    });
    fireEvent.change(screen.getByTestId("new-preset-focus-mode"), {
      target: { value: "AUTO" },
    });
    fireEvent.click(screen.getByTestId("save-new-preset"));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: "My Preset",
        drone_profile_id: "drone-1",
        is_default: true,
        white_balance: "DAYLIGHT",
        iso: 400,
        shutter_speed: "1/500",
        focus_mode: "AUTO",
      }),
    );
  });

  it("sends the edit save payload", async () => {
    mockList.mockResolvedValue({ data: [preset] });
    render(<CameraPresetsPanel droneId="drone-1" />);

    fireEvent.click(await screen.findByTestId("preset-row-p1"));
    fireEvent.change(screen.getByTestId("edit-preset-name-p1"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByText("common.save"));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("p1", {
        name: "Renamed",
        white_balance: "CLOUDY",
        iso: 800,
        shutter_speed: "1/250",
        focus_mode: "AUTO",
      }),
    );
  });

  it("toggles is_default via the star button", async () => {
    mockList.mockResolvedValue({ data: [preset] });
    render(<CameraPresetsPanel droneId="drone-1" />);

    fireEvent.click(await screen.findByTestId("preset-star-p1"));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith("p1", { is_default: true }),
    );
  });

  it("opens the edit form when the preset row is activated by keyboard", async () => {
    mockList.mockResolvedValue({ data: [preset] });
    render(<CameraPresetsPanel droneId="drone-1" />);

    const row = await screen.findByTestId("preset-row-p1");
    expect(row).toHaveAttribute("role", "button");
    fireEvent.keyDown(row, { key: "Enter" });

    expect(await screen.findByTestId("edit-preset-name-p1")).toBeInTheDocument();
  });

  it("associates a label with the new preset name input", async () => {
    render(<CameraPresetsPanel droneId="drone-1" />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("add-preset-btn"));
    expect(
      screen.getByLabelText("coordinator.cameraPresets.name"),
    ).toBe(screen.getByTestId("new-preset-name"));
  });
});
