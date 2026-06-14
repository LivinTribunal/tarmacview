import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import TerrainSettingsCard from "./TerrainSettingsCard";
import type { AirportDetailResponse } from "@/types/airport";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const mockUpload = vi.fn();
const mockDownload = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/api/airports", () => ({
  uploadTerrainDEM: (...args: unknown[]) => mockUpload(...args),
  deleteTerrainDEM: (...args: unknown[]) => mockDelete(...args),
  downloadTerrainData: (...args: unknown[]) => mockDownload(...args),
}));

const systemSettingsRef: {
  settings: {
    maintenance_mode: boolean;
    cesium_ion_token: string;
    elevation_api_url: string;
    elevation_api_fallback_enabled: boolean;
  } | null;
} = { settings: null };

vi.mock("@/contexts/SystemSettingsContext", () => ({
  useSystemSettings: () => ({
    settings: systemSettingsRef.settings,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/common/InfoHint", () => ({
  default: () => <span />,
}));

function makeAirport(overrides: Partial<AirportDetailResponse> = {}): AirportDetailResponse {
  /** minimal AirportDetailResponse for the card. */
  return {
    id: "ap-1",
    icao_code: "TEST",
    name: "Test",
    city: null,
    country: null,
    elevation: 250,
    location: { type: "Point", coordinates: [14.0, 50.0, 250] },
    default_drone_profile_id: null,
    terrain_source: "FLAT",
    has_dem: false,
    surfaces: [],
    obstacles: [],
    safety_zones: [],
    ...overrides,
  };
}

function openCard() {
  /** click the header tag to expand the collapsible card. */
  fireEvent.click(screen.getByText("coordinator.terrain.title"));
}

function radiosByRowText() {
  /** map { flat, upload, api } radio inputs by walking each radio's parent label. */
  const radios = screen.getAllByRole("radio") as HTMLInputElement[];
  const out: Record<string, HTMLInputElement> = {};
  for (const input of radios) {
    const row = input.closest("label");
    if (!row) continue;
    const heading = row.querySelector("p");
    const key = (heading?.firstChild?.textContent ?? heading?.textContent ?? "").trim();
    if (key === "coordinator.terrain.flat") out.flat = input;
    if (key === "coordinator.terrain.uploadDem") out.upload = input;
    if (key === "coordinator.terrain.downloadApi") out.api = input;
  }
  return out;
}

describe("TerrainSettingsCard default selection matrix", () => {
  /** verify pre-selected radio and 'Recommended' tag per the rollout matrix. */

  beforeEach(() => {
    mockUpload.mockReset();
    mockDownload.mockReset();
    mockDelete.mockReset();
    systemSettingsRef.settings = {
      maintenance_mode: false,
      cesium_ion_token: "",
      elevation_api_url: "",
      elevation_api_fallback_enabled: false,
    };
  });

  it("FLAT airport with API fallback off keeps FLAT pre-selected", () => {
    /** flag off -> default radio remains Flat. */
    const airport = makeAirport({ terrain_source: "FLAT", has_dem: false });
    render(<TerrainSettingsCard airport={airport} onUpdate={vi.fn()} />);
    openCard();

    const radios = radiosByRowText();
    expect(radios.flat.checked).toBe(true);
    expect(radios.api.checked).toBe(false);
    expect(screen.queryByTestId("api-recommended-tag")).toBeNull();
  });

  it("FLAT airport with API fallback on highlights Download from API", () => {
    /** flag on + FLAT + no DEM -> DEM_API pre-selected and tagged Recommended. */
    systemSettingsRef.settings = {
      maintenance_mode: false,
      cesium_ion_token: "",
      elevation_api_url: "",
      elevation_api_fallback_enabled: true,
    };
    const airport = makeAirport({ terrain_source: "FLAT", has_dem: false });
    render(<TerrainSettingsCard airport={airport} onUpdate={vi.fn()} />);
    openCard();

    const radios = radiosByRowText();
    expect(radios.api.checked).toBe(true);
    expect(radios.flat.checked).toBe(false);
    expect(screen.getByTestId("api-recommended-tag")).toBeInTheDocument();
  });

  it("airport with uploaded DEM defaults to DEM_UPLOAD regardless of flag", () => {
    /** has_dem wins over the system flag. */
    systemSettingsRef.settings!.elevation_api_fallback_enabled = true;
    const airport = makeAirport({ terrain_source: "DEM_UPLOAD", has_dem: true });
    render(<TerrainSettingsCard airport={airport} onUpdate={vi.fn()} />);
    openCard();

    const radios = radiosByRowText();
    expect(radios.upload.checked).toBe(true);
  });
});

describe("TerrainSettingsCard rewrite-existing toggle", () => {
  /** verify the rewrite-existing checkbox plumbs through to the API call. */

  beforeEach(() => {
    mockUpload.mockReset();
    mockDownload.mockReset();
    mockDelete.mockReset();
    systemSettingsRef.settings = {
      maintenance_mode: false,
      cesium_ion_token: "",
      elevation_api_url: "",
      elevation_api_fallback_enabled: true,
    };
  });

  it("download passes rewriteExisting:false when the checkbox is unticked", async () => {
    /** unticking the checkbox forwards rewriteExisting:false to downloadTerrainData. */
    mockDownload.mockResolvedValue({
      terrain_source: "DEM_API",
      points_downloaded: 100,
      coverage: { bounds: [0, 0, 0, 0], resolution: [0.0003, 0.0003] },
    });
    const airport = makeAirport({ terrain_source: "FLAT", has_dem: false });
    render(<TerrainSettingsCard airport={airport} onUpdate={vi.fn()} />);
    openCard();

    const checkbox = screen.getByTestId("rewrite-existing-checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    // the per-action button sits inside the DEM_API panel and is the only
    // button at the "downloadApi" loading-state label.
    const downloadBtn = within(
      checkbox.closest("[data-testid='terrain-settings-card']")!,
    ).getAllByRole("button").find((b) =>
      b.textContent?.includes("coordinator.terrain.downloadApi"),
    );
    expect(downloadBtn).toBeTruthy();
    fireEvent.click(downloadBtn!);
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockDownload).toHaveBeenCalledWith(airport.id, { rewriteExisting: false });
  });

  it("download defaults rewriteExisting:true when the box stays checked", async () => {
    /** default-checked state forwards rewriteExisting:true. */
    mockDownload.mockResolvedValue({
      terrain_source: "DEM_API",
      points_downloaded: 100,
      coverage: { bounds: [0, 0, 0, 0], resolution: [0.0003, 0.0003] },
    });
    const airport = makeAirport({ terrain_source: "FLAT", has_dem: false });
    render(<TerrainSettingsCard airport={airport} onUpdate={vi.fn()} />);
    openCard();

    const checkbox = screen.getByTestId("rewrite-existing-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const downloadBtn = within(
      checkbox.closest("[data-testid='terrain-settings-card']")!,
    ).getAllByRole("button").find((b) =>
      b.textContent?.includes("coordinator.terrain.downloadApi"),
    );
    fireEvent.click(downloadBtn!);
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    expect(mockDownload).toHaveBeenCalledWith(airport.id, { rewriteExisting: true });
  });
});
