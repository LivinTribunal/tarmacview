import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import useTakeoffLandingPicker from "./useTakeoffLandingPicker";
import { computePlacementUpdates } from "@/utils/takeoffLandingPlacement";
import type { PlacementUpdates } from "@/utils/takeoffLandingPlacement";
import type { MissionDetailResponse, MissionUpdate } from "@/types/mission";
import type { PointZ } from "@/types/common";

vi.mock("@/utils/takeoffLandingPlacement", () => ({
  computePlacementUpdates: vi.fn(),
}));

vi.mock("@/hooks/useElevationResolver", () => ({
  useElevationResolver: () => vi.fn(),
}));

function pt(lon: number, lat: number, alt: number): PointZ {
  return { type: "Point", coordinates: [lon, lat, alt] };
}

function makeMission(
  id: string,
  takeoff: PointZ | null,
  landing: PointZ | null,
): MissionDetailResponse {
  return {
    id,
    airport_id: "apt-1",
    takeoff_coordinate: takeoff,
    landing_coordinate: landing,
  } as MissionDetailResponse;
}

describe("useTakeoffLandingPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives the round-trip toggle from persisted coordinates on mount", () => {
    /** equal takeoff/landing -> on; distinct -> off; null -> off. */
    const shared = pt(17.21, 48.17, 133);
    const equal = renderHook(() =>
      useTakeoffLandingPicker({
        mission: makeMission("m-1", shared, shared),
        missionDirty: {},
        airportDetail: null,
        handleMissionChange: vi.fn(),
      }),
    );
    expect(equal.result.current.useTakeoffAsLanding).toBe(true);

    const distinct = renderHook(() =>
      useTakeoffLandingPicker({
        mission: makeMission("m-2", pt(17.21, 48.17, 133), pt(17.3, 48.2, 140)),
        missionDirty: {},
        airportDetail: null,
        handleMissionChange: vi.fn(),
      }),
    );
    expect(distinct.result.current.useTakeoffAsLanding).toBe(false);

    const empty = renderHook(() =>
      useTakeoffLandingPicker({
        mission: makeMission("m-3", null, null),
        missionDirty: {},
        airportDetail: null,
        handleMissionChange: vi.fn(),
      }),
    );
    expect(empty.result.current.useTakeoffAsLanding).toBe(false);
  });

  it("handleMapClick reads the latest mission/dirty via refs after a re-render", async () => {
    /** the empty-deps click handler must see fresh props through its ref
     *  mirrors, not the values captured on first render. */
    const handleMissionChange = vi.fn();
    const update: PlacementUpdates = { takeoff_coordinate: pt(1, 2, 3) };
    vi.mocked(computePlacementUpdates).mockResolvedValue(update);

    const initialMission = makeMission("m-1", null, null);
    const { result, rerender } = renderHook(
      (props: {
        mission: MissionDetailResponse;
        missionDirty: Partial<MissionUpdate>;
      }) =>
        useTakeoffLandingPicker({
          mission: props.mission,
          missionDirty: props.missionDirty,
          airportDetail: null,
          handleMissionChange,
        }),
      { initialProps: { mission: initialMission, missionDirty: {} } },
    );

    act(() => {
      result.current.setPickingCoord("takeoff");
    });

    // re-render with fresh mission + dirty - refs must pick these up
    const freshTakeoff = pt(17.5, 48.5, 100);
    rerender({
      mission: makeMission("m-1", freshTakeoff, null),
      missionDirty: { landing_coordinate: pt(18, 49, 110) },
    });

    await act(async () => {
      await result.current.handleMapClick({ lng: 10, lat: 20 });
    });

    expect(computePlacementUpdates).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(computePlacementUpdates).mock.calls[0];
    expect(callArgs[2]).toEqual({
      takeoff_coordinate: freshTakeoff,
      landing_coordinate: pt(18, 49, 110),
    });
    expect(handleMissionChange).toHaveBeenCalledWith(update);
    expect(result.current.pickingCoord).toBeNull();
  });

  it("handleMapClick calls the latest handleMissionChange after it changes identity", async () => {
    /** handleMissionChange is mirrored into a ref so the empty-deps click
     *  handler invokes the freshest callback, not the one from first render. */
    const first = vi.fn();
    const second = vi.fn();
    const update: PlacementUpdates = { takeoff_coordinate: pt(1, 2, 3) };
    vi.mocked(computePlacementUpdates).mockResolvedValue(update);

    const { result, rerender } = renderHook(
      (props: { handleMissionChange: (u: Partial<MissionUpdate>) => void }) =>
        useTakeoffLandingPicker({
          mission: makeMission("m-1", null, null),
          missionDirty: {},
          airportDetail: null,
          handleMissionChange: props.handleMissionChange,
        }),
      { initialProps: { handleMissionChange: first } },
    );

    act(() => {
      result.current.setPickingCoord("takeoff");
    });

    rerender({ handleMissionChange: second });

    await act(async () => {
      await result.current.handleMapClick({ lng: 10, lat: 20 });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(update);
  });
});
