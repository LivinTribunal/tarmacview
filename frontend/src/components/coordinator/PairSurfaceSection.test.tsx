import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PairSurfaceSection, { PairSurfaceDialog } from "./PairSurfaceSection";
import type { SurfaceResponse } from "@/types/airport";

vi.mock("@/api/airports", () => ({
  coupleSurface: vi.fn(),
  decoupleSurface: vi.fn(),
  createReverseSurface: vi.fn(),
}));

import {
  coupleSurface,
  decoupleSurface,
  createReverseSurface,
} from "@/api/airports";

function makeSurface(overrides: Partial<SurfaceResponse> = {}): SurfaceResponse {
  return {
    id: "s-a",
    airport_id: "ap-1",
    identifier: "01",
    surface_type: "RUNWAY",
    geometry: {
      type: "LineString",
      coordinates: [
        [14.24, 50.1, 380],
        [14.27, 50.09, 380],
      ],
    },
    boundary: null,
    buffer_distance: 30,
    heading: 10,
    length: 3000,
    width: 45,
    threshold_position: null,
    end_position: null,
    touchpoint_latitude: null,
    touchpoint_longitude: null,
    touchpoint_altitude: null,
    paired_surface_id: null,
    agls: [],
    ...overrides,
  };
}

describe("PairSurfaceSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for taxiway surfaces", () => {
    const taxi = makeSurface({ surface_type: "TAXIWAY" });
    const { container } = render(
      <PairSurfaceSection
        airportId="ap-1"
        surface={taxi}
        surfaces={[taxi]}
        onChanged={() => {}}
      />,
    );
    expect(container.querySelector("[data-testid='surface-pair-section']")).toBeNull();
  });

  it("shows create-reverse and pair-with when uncoupled", () => {
    const a = makeSurface({ id: "s-a" });
    const b = makeSurface({ id: "s-b", identifier: "19" });
    render(
      <PairSurfaceSection
        airportId="ap-1"
        surface={a}
        surfaces={[a, b]}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByTestId("surface-pair-create-reverse")).toBeInTheDocument();
    expect(screen.getByTestId("surface-pair-couple")).toBeInTheDocument();
    expect(screen.queryByTestId("surface-pair-decouple")).toBeNull();
  });

  it("shows decouple action only when coupled", () => {
    const a = makeSurface({ id: "s-a", paired_surface_id: "s-b" });
    const b = makeSurface({ id: "s-b", identifier: "19", paired_surface_id: "s-a" });
    render(
      <PairSurfaceSection
        airportId="ap-1"
        surface={a}
        surfaces={[a, b]}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByTestId("surface-pair-decouple")).toBeInTheDocument();
    expect(screen.queryByTestId("surface-pair-create-reverse")).toBeNull();
    expect(screen.queryByTestId("surface-pair-couple")).toBeNull();
  });

  it("calls createReverseSurface when create-reverse clicked", async () => {
    const mock = createReverseSurface as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ id: "s-rev" });
    const onChanged = vi.fn();
    const a = makeSurface();
    render(
      <PairSurfaceSection
        airportId="ap-1"
        surface={a}
        surfaces={[a]}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByTestId("surface-pair-create-reverse"));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("ap-1", "s-a", {}));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("calls decoupleSurface when decouple clicked", async () => {
    const mock = decoupleSurface as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ id: "s-a" });
    const onChanged = vi.fn();
    const a = makeSurface({ paired_surface_id: "s-b" });
    const b = makeSurface({ id: "s-b", identifier: "19", paired_surface_id: "s-a" });
    render(
      <PairSurfaceSection
        airportId="ap-1"
        surface={a}
        surfaces={[a, b]}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByTestId("surface-pair-decouple"));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("ap-1", "s-a"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("PairSurfaceDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits couple with selected target and primary side", async () => {
    const mock = coupleSurface as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValue({ id: "s-a", paired_surface_id: "s-b" });
    const onPaired = vi.fn();
    const a = makeSurface({ id: "s-a" });
    const b = makeSurface({ id: "s-b", identifier: "19" });

    render(
      <PairSurfaceDialog
        airportId="ap-1"
        surface={a}
        candidates={[b]}
        onClose={() => {}}
        onPaired={onPaired}
      />,
    );

    // primary defaults to "self"; switch to target then submit
    fireEvent.click(screen.getByTestId("surface-pair-dialog-primary-target"));
    fireEvent.click(screen.getByTestId("surface-pair-dialog-confirm"));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith("ap-1", "s-a", {
        target_surface_id: "s-b",
        primary: "target",
      }),
    );
    await waitFor(() => expect(onPaired).toHaveBeenCalled());
  });
});
