/**
 * tests for RequireMissionAirportMatch route guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router";
import RequireMissionAirportMatch from "./RequireMissionAirportMatch";
import { getMission } from "@/api/missions";
import type { MissionDetailResponse } from "@/types/mission";

type MissionResolver = (value: MissionDetailResponse) => void;

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
}));

let mockSelectedAirport: { id: string } | null = { id: "apt-A1" };

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: mockSelectedAirport }),
}));

function renderGuard(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/operator-center/missions/:id"
          element={<RequireMissionAirportMatch />}
        >
          <Route
            path="map"
            element={<div data-testid="protected-child">protected</div>}
          />
        </Route>
        <Route
          path="/operator-center/dashboard"
          element={<div data-testid="dashboard">dashboard</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireMissionAirportMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedAirport = { id: "apt-A1" };
  });

  it("renders the child outlet when mission airport matches selectedAirport", async () => {
    /** match case - guard allows render. */
    vi.mocked(getMission).mockResolvedValueOnce({
      id: "m-1",
      airport_id: "apt-A1",
    } as never);

    renderGuard("/operator-center/missions/m-1/map");

    await waitFor(() => {
      expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    });
    expect(getMission).toHaveBeenCalledWith("m-1");
  });

  it("redirects to dashboard when mission airport differs from selectedAirport", async () => {
    /** mismatch case - guard redirects. */
    vi.mocked(getMission).mockResolvedValueOnce({
      id: "m-2",
      airport_id: "apt-A2",
    } as never);

    renderGuard("/operator-center/missions/m-2/map");

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("redirects to dashboard when no airport is selected", async () => {
    /** no-airport regression guard for #204 hard gate. */
    mockSelectedAirport = null;

    renderGuard("/operator-center/missions/m-1/map");

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
    expect(getMission).not.toHaveBeenCalled();
  });

  it("redirects to dashboard when getMission rejects", async () => {
    /** error path - 404 or network failure routes back to dashboard. */
    vi.mocked(getMission).mockRejectedValueOnce(new Error("not found"));

    renderGuard("/operator-center/missions/m-bad/map");

    await waitFor(() => {
      expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    });
  });

  it("renders nothing while the mission fetch is pending", async () => {
    /** no UI leak during the mismatched window. */
    let resolveFn: MissionResolver | null = null;
    vi.mocked(getMission).mockImplementationOnce(
      () =>
        new Promise<MissionDetailResponse>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const { container } = renderGuard("/operator-center/missions/m-1/map");

    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();

    (resolveFn as MissionResolver | null)?.({
      id: "m-1",
      airport_id: "apt-A1",
    } as MissionDetailResponse);

    await waitFor(() => {
      expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    });
  });

  it("re-evaluates when the :id route param changes between two airports", async () => {
    /** verifies the guard re-checks on id change and ignores the stale fetch. */
    let resolveStale: MissionResolver | null = null;
    vi.mocked(getMission).mockImplementationOnce(
      () =>
        new Promise<MissionDetailResponse>((resolve) => {
          resolveStale = resolve;
        }),
    );
    vi.mocked(getMission).mockResolvedValueOnce({
      id: "m-2",
      airport_id: "apt-A1",
    } as never);

    function Switcher() {
      /** test helper - triggers an in-router navigate to mission m-2. */
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="go-m2"
          onClick={() => navigate("/operator-center/missions/m-2/map")}
        >
          go
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/operator-center/missions/m-1/map"]}>
        <Switcher />
        <Routes>
          <Route
            path="/operator-center/missions/:id"
            element={<RequireMissionAirportMatch />}
          >
            <Route
              path="map"
              element={<div data-testid="protected-child">protected</div>}
            />
          </Route>
          <Route
            path="/operator-center/dashboard"
            element={<div data-testid="dashboard">dashboard</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    // first fetch is pending - nothing rendered
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();

    // navigate to m-2 - cancellation flag fires for the m-1 fetch
    act(() => {
      screen.getByTestId("go-m2").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    });
    expect(getMission).toHaveBeenCalledTimes(2);
    expect(getMission).toHaveBeenNthCalledWith(1, "m-1");
    expect(getMission).toHaveBeenNthCalledWith(2, "m-2");

    // resolve stale m-1 fetch with a mismatch payload - must be ignored
    await act(async () => {
      (resolveStale as MissionResolver | null)?.({
        id: "m-1",
        airport_id: "apt-A2",
      } as MissionDetailResponse);
      await Promise.resolve();
    });

    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("does not flash the previous match when :id changes mid-session", async () => {
    /** regression: stale "match" must not let Outlet mount for one frame after id changes. */
    vi.mocked(getMission).mockResolvedValueOnce({
      id: "m-1",
      airport_id: "apt-A1",
    } as never);
    let resolveSecond: MissionResolver | null = null;
    vi.mocked(getMission).mockImplementationOnce(
      () =>
        new Promise<MissionDetailResponse>((resolve) => {
          resolveSecond = resolve;
        }),
    );

    function Switcher() {
      /** test helper - navigates to mission m-2 in-router. */
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="go-m2"
          onClick={() => navigate("/operator-center/missions/m-2/map")}
        >
          go
        </button>
      );
    }

    render(
      <MemoryRouter initialEntries={["/operator-center/missions/m-1/map"]}>
        <Switcher />
        <Routes>
          <Route
            path="/operator-center/missions/:id"
            element={<RequireMissionAirportMatch />}
          >
            <Route
              path="map"
              element={<div data-testid="protected-child">protected</div>}
            />
          </Route>
          <Route
            path="/operator-center/dashboard"
            element={<div data-testid="dashboard">dashboard</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    // wait for m-1 to enter the "match" state and render the outlet
    await waitFor(() => {
      expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    });

    // navigate to m-2 while its fetch stays pending - outlet must disappear
    // synchronously instead of lingering with the previous "match" verdict
    act(() => {
      screen.getByTestId("go-m2").click();
    });

    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();

    await act(async () => {
      (resolveSecond as MissionResolver | null)?.({
        id: "m-2",
        airport_id: "apt-A1",
      } as MissionDetailResponse);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    });
  });
});
