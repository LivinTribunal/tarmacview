import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AirportLookupResponse } from "@/types/airport";
import useAirportLookup from "./useAirportLookup";

vi.mock("@/api/airports", () => ({
  lookupAirport: vi.fn(),
  createSurface: vi.fn(),
  createObstacle: vi.fn(),
  createSafetyZone: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  default: {},
  isAxiosError: (err: unknown): err is { response?: { status?: number } } =>
    typeof err === "object" && err !== null && "isAxiosError" in err,
}));

import {
  lookupAirport,
  createSurface,
  createObstacle,
  createSafetyZone,
} from "@/api/airports";

const mockLookup = lookupAirport as unknown as ReturnType<typeof vi.fn>;
const mockCreateSurface = createSurface as unknown as ReturnType<typeof vi.fn>;
const mockCreateObstacle = createObstacle as unknown as ReturnType<typeof vi.fn>;
const mockCreateSafetyZone = createSafetyZone as unknown as ReturnType<typeof vi.fn>;

function makeAxiosError(status: number) {
  /** stub satisfying the mocked isAxiosError check. */
  return { isAxiosError: true, response: { status } };
}

function makeLookupResponse(
  overrides: Partial<AirportLookupResponse> = {},
): AirportLookupResponse {
  /** minimal but type-valid lookup response. */
  return {
    icao_code: "LZIB",
    name: "Bratislava Airport",
    city: "Bratislava",
    country: "Slovakia",
    elevation: 133,
    location: { type: "Point", coordinates: [17.21, 48.17, 133] },
    runways: [
      {
        identifier: "04",
        heading: 40,
        length: 2900,
        width: 45,
        threshold_position: { type: "Point", coordinates: [17.21, 48.17, 133] },
        end_position: { type: "Point", coordinates: [17.23, 48.19, 133] },
        geometry: {
          type: "LineString",
          coordinates: [
            [17.21, 48.17, 133],
            [17.23, 48.19, 133],
          ],
        },
        boundary: {
          type: "Polygon",
          coordinates: [
            [
              [17.21, 48.17, 133],
              [17.23, 48.19, 133],
              [17.23, 48.18, 133],
              [17.21, 48.16, 133],
              [17.21, 48.17, 133],
            ],
          ],
        },
      },
      {
        identifier: "22",
        heading: 220,
        length: 2900,
        width: 45,
        threshold_position: { type: "Point", coordinates: [17.23, 48.19, 133] },
        end_position: { type: "Point", coordinates: [17.21, 48.17, 133] },
        geometry: {
          type: "LineString",
          coordinates: [
            [17.23, 48.19, 133],
            [17.21, 48.17, 133],
          ],
        },
        boundary: {
          type: "Polygon",
          coordinates: [
            [
              [17.23, 48.19, 133],
              [17.21, 48.17, 133],
              [17.21, 48.16, 133],
              [17.23, 48.18, 133],
              [17.23, 48.19, 133],
            ],
          ],
        },
      },
    ],
    obstacles: [
      {
        name: "TV Mast",
        type: "TOWER",
        height: 120,
        boundary: {
          type: "Polygon",
          coordinates: [
            [
              [17.22, 48.18, 133],
              [17.221, 48.18, 133],
              [17.221, 48.181, 133],
              [17.22, 48.181, 133],
              [17.22, 48.18, 133],
            ],
          ],
        },
      },
    ],
    safety_zones: [
      {
        name: "LZIB CTR",
        type: "CTR",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [17.2, 48.1, 0],
              [17.3, 48.1, 0],
              [17.3, 48.2, 0],
              [17.2, 48.2, 0],
              [17.2, 48.1, 0],
            ],
          ],
        },
        altitude_floor: 0,
        altitude_ceiling: 1524,
      },
    ],
    ...overrides,
  };
}

function setup(overrides: Partial<Parameters<typeof useAirportLookup>[0]> = {}) {
  /** render the hook with vi.fn stubs for every collaborator. */
  const setErrors = vi.fn();
  const setName = vi.fn();
  const setCity = vi.fn();
  const setCountry = vi.fn();
  const setLat = vi.fn();
  const setLon = vi.fn();
  const setAlt = vi.fn();
  const params = {
    isOpen: true,
    icaoCode: "LZIB",
    importRadius: "3",
    setErrors,
    t: (key: string) => key,
    setName,
    setCity,
    setCountry,
    setLat,
    setLon,
    setAlt,
    ...overrides,
  };
  const utils = renderHook((p: typeof params) => useAirportLookup(p), {
    initialProps: params,
  });
  return {
    ...utils,
    setErrors,
    setName,
    setCity,
    setCountry,
    setLat,
    setLon,
    setAlt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAirportLookup - applyLookup", () => {
  it("populates suggestions (all checked) and fills the form", () => {
    const { result, setName, setLat, setLon, setAlt } = setup();

    act(() => {
      result.current.applyLookup(makeLookupResponse());
    });

    expect(result.current.suggestions?.runways).toHaveLength(2);
    expect(result.current.suggestions?.runways.every((r) => r.checked)).toBe(true);
    expect(result.current.suggestions?.obstacles[0].checked).toBe(true);
    expect(result.current.suggestions?.safetyZones[0].checked).toBe(true);
    expect(result.current.lookupEmpty).toBe(false);
    expect(setName).toHaveBeenCalledWith("Bratislava Airport");
    expect(setLat).toHaveBeenCalledWith("48.170000");
    expect(setLon).toHaveBeenCalledWith("17.210000");
    expect(setAlt).toHaveBeenCalledWith("133.0");
  });

  it("flags lookupEmpty when the payload has no suggestions", () => {
    const { result } = setup();

    act(() => {
      result.current.applyLookup(
        makeLookupResponse({ runways: [], obstacles: [], safety_zones: [] }),
      );
    });

    expect(result.current.lookupEmpty).toBe(true);
    expect(result.current.suggestions?.runways).toHaveLength(0);
  });
});

describe("useAirportLookup - toggles", () => {
  it("toggleRunway flips only the targeted runway", () => {
    const { result } = setup();
    act(() => result.current.applyLookup(makeLookupResponse()));

    act(() => result.current.toggleRunway(0));

    expect(result.current.suggestions?.runways[0].checked).toBe(false);
    expect(result.current.suggestions?.runways[1].checked).toBe(true);
    expect(result.current.suggestions?.safetyZones[0].checked).toBe(true);
  });

  it("setSectionChecked unchecks every item in one section only", () => {
    const { result } = setup();
    act(() => result.current.applyLookup(makeLookupResponse()));

    act(() => result.current.setSectionChecked("runways", false));

    expect(result.current.suggestions?.runways.every((r) => !r.checked)).toBe(true);
    expect(result.current.suggestions?.obstacles[0].checked).toBe(true);
    expect(result.current.suggestions?.safetyZones[0].checked).toBe(true);
  });

  it("setAllChecked flips every suggestion across all sections", () => {
    const { result } = setup();
    act(() => result.current.applyLookup(makeLookupResponse()));

    act(() => result.current.setAllChecked(false));
    expect(result.current.suggestions?.runways.every((r) => !r.checked)).toBe(true);
    expect(result.current.suggestions?.obstacles.every((o) => !o.checked)).toBe(true);
    expect(result.current.suggestions?.safetyZones.every((z) => !z.checked)).toBe(true);

    act(() => result.current.setAllChecked(true));
    expect(result.current.suggestions?.runways.every((r) => r.checked)).toBe(true);
  });

  it("toggleSection collapses then expands a section", () => {
    const { result } = setup();
    expect(result.current.expanded.runways).toBe(true);

    act(() => result.current.toggleSection("runways"));
    expect(result.current.expanded.runways).toBe(false);
    expect(result.current.expanded.obstacles).toBe(true);
  });
});

describe("useAirportLookup - createCheckedSuggestions", () => {
  it("creates checked children in runway→obstacle→zone order and counts failures", async () => {
    const order: string[] = [];
    mockCreateSurface.mockImplementation(() => {
      order.push("surface");
      return Promise.resolve({});
    });
    mockCreateObstacle.mockImplementation(() => {
      order.push("obstacle");
      return Promise.reject(new Error("nope"));
    });
    mockCreateSafetyZone.mockImplementation(() => {
      order.push("zone");
      return Promise.resolve({});
    });

    const { result } = setup();
    act(() => result.current.applyLookup(makeLookupResponse()));

    let failed = -1;
    await act(async () => {
      failed = await result.current.createCheckedSuggestions("apt-1");
    });

    expect(failed).toBe(1);
    expect(mockCreateSurface).toHaveBeenCalledTimes(2);
    expect(mockCreateObstacle).toHaveBeenCalledTimes(1);
    expect(mockCreateSafetyZone).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["surface", "surface", "obstacle", "zone"]);
  });

  it("skips unchecked sections", async () => {
    mockCreateSurface.mockResolvedValue({});
    mockCreateObstacle.mockResolvedValue({});
    mockCreateSafetyZone.mockResolvedValue({});

    const { result } = setup();
    act(() => result.current.applyLookup(makeLookupResponse()));
    act(() => result.current.setSectionChecked("runways", false));

    await act(async () => {
      await result.current.createCheckedSuggestions("apt-1");
    });

    expect(mockCreateSurface).not.toHaveBeenCalled();
    expect(mockCreateObstacle).toHaveBeenCalledTimes(1);
    expect(mockCreateSafetyZone).toHaveBeenCalledTimes(1);
  });

  it("returns 0 when there are no suggestions", async () => {
    const { result } = setup();

    let failed = -1;
    await act(async () => {
      failed = await result.current.createCheckedSuggestions("apt-1");
    });

    expect(failed).toBe(0);
  });
});

describe("useAirportLookup - handleLookup", () => {
  it("blocks lookup and sets icao error when icao is invalid", async () => {
    const { result, setErrors } = setup({ icaoCode: "X" });

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(setErrors).toHaveBeenCalledWith({
      icaoCode: "coordinator.createAirport.icaoRequired",
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks lookup and sets radius error when radius is out of bounds", async () => {
    const { result, setErrors } = setup({ importRadius: "999" });

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(setErrors).toHaveBeenCalledWith({
      importRadius: "coordinator.createAirport.importRadiusInvalid",
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("maps a 404 to the not-found message", async () => {
    mockLookup.mockRejectedValueOnce(makeAxiosError(404));
    const { result } = setup();

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(result.current.lookupError).toBe(
      "coordinator.createAirport.lookup.notFound",
    );
  });

  it("maps a 503 to the no-api-key message", async () => {
    mockLookup.mockRejectedValueOnce(makeAxiosError(503));
    const { result } = setup();

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(result.current.lookupError).toBe(
      "coordinator.createAirport.lookup.noApiKey",
    );
  });

  it("maps any other error to the generic api-down message", async () => {
    mockLookup.mockRejectedValueOnce(new Error("boom"));
    const { result } = setup();

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(result.current.lookupError).toBe(
      "coordinator.createAirport.lookup.apiDown",
    );
  });

  it("applies the response on success", async () => {
    mockLookup.mockResolvedValueOnce(makeLookupResponse());
    const { result } = setup();

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(mockLookup).toHaveBeenCalledWith("LZIB", 3);
    expect(result.current.suggestions?.runways).toHaveLength(2);
  });
});
