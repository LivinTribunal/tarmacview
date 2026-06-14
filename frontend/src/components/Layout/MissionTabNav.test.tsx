import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useOutletContext } from "react-router";
import MissionTabNav, { type MissionTabOutletContext, type ComputeContext } from "./MissionTabNav";
import { duplicateMission } from "@/api/missions";
import en from "@/i18n/locales/en.json";
import sk from "@/i18n/locales/sk.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const { mockDeleteMission, mockRefreshMissions: hoistedRefresh, mockNavigate: hoistedNavigate } = vi.hoisted(() => ({
  mockDeleteMission: vi.fn(() => Promise.resolve({ deleted: true })),
  mockRefreshMissions: vi.fn(() => Promise.resolve()),
  mockNavigate: vi.fn(),
}));
vi.mock("@/api/missions", () => ({
  updateMission: vi.fn(),
  duplicateMission: vi.fn(() => Promise.resolve({ id: "copy-1" })),
  deleteMission: mockDeleteMission,
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => hoistedNavigate,
    useParams: () => ({ id: "mission-1" }),
    useLocation: () => ({ pathname: "/operator-center/missions/mission-1/configuration" }),
  };
});

vi.mock("@/contexts/MissionContext", () => ({
  useMission: () => ({
    missions: [
      { id: "mission-1", name: "Test Mission", status: "DRAFT" },
    ],
    selectedMission: null,
    refreshMissions: hoistedRefresh,
    updateMissionInList: vi.fn(),
  }),
}));

/** render mission tab nav in a memory router. */
function renderComponent() {
  return render(
    <MemoryRouter initialEntries={["/operator-center/missions/mission-1/configuration"]}>
      <MissionTabNav />
    </MemoryRouter>,
  );
}

/** child route helper that pushes a compute context into the outlet. */
function ComputeContextSetter({ ctx }: { ctx: ComputeContext }) {
  const { setComputeContext } = useOutletContext<MissionTabOutletContext>();
  useEffect(() => {
    setComputeContext(ctx);
  }, [setComputeContext, ctx]);
  return null;
}

/** render mission tab nav with a child route that seeds the compute context. */
function renderWithComputeContext(ctx: ComputeContext) {
  return render(
    <MemoryRouter initialEntries={["/operator-center/missions/mission-1/configuration"]}>
      <Routes>
        <Route path="/operator-center/missions/:id" element={<MissionTabNav />}>
          <Route path="configuration" element={<ComputeContextSetter ctx={ctx} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("MissionTabNav delete action", () => {
  /** tests for the delete button and confirmation dialog in mission selector. */
  beforeEach(() => {
    hoistedNavigate.mockClear();
    mockDeleteMission.mockClear();
    hoistedRefresh.mockClear();
  });

  it("renders the delete action button", () => {
    renderComponent();
    const deleteBtn = screen.getByTitle("common.delete");
    expect(deleteBtn).toBeInTheDocument();
  });

  it("opens confirmation modal when delete is clicked", () => {
    renderComponent();
    fireEvent.click(screen.getByTitle("common.delete"));
    expect(screen.getByText("mission.validationExportPage.deleteConfirmMessage")).toBeInTheDocument();
  });

  it("closes modal when cancel is clicked", () => {
    renderComponent();
    fireEvent.click(screen.getByTitle("common.delete"));
    expect(screen.getByText("mission.validationExportPage.deleteConfirmMessage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(screen.queryByText("mission.validationExportPage.deleteConfirmMessage")).not.toBeInTheDocument();
    expect(mockDeleteMission).not.toHaveBeenCalled();
  });

  it("calls deleteMission and navigates on confirm", async () => {
    renderComponent();
    fireEvent.click(screen.getByTitle("common.delete"));

    const modal = screen.getByRole("dialog");
    const confirmBtn = modal.querySelector("button.bg-tv-error") as HTMLElement;
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteMission).toHaveBeenCalledWith("mission-1");
    });
    await waitFor(() => {
      expect(hoistedNavigate).toHaveBeenCalledWith("/operator-center/missions");
    });
  });
});

describe("MissionTabNav duplicate action i18n", () => {
  /** the duplicate button binds title={t("mission.duplicate")}; that key must
   * exist in every locale or the raw key text leaks into the tooltip. */
  it("defines mission.duplicate in en and sk locales", () => {
    expect(en.mission.duplicate).toBe("Duplicate");
    expect(sk.mission.duplicate).toBe("Duplikovať");
  });

  it("keeps mission.duplicate present (non-empty) across locales for parity", () => {
    for (const locale of [en, sk]) {
      expect(typeof locale.mission.duplicate).toBe("string");
      expect(locale.mission.duplicate.length).toBeGreaterThan(0);
    }
  });

  it("renders a duplicate button bound to the mission.duplicate key", () => {
    renderComponent();
    // under the test i18n mock t() echoes the key, so a resolved title proves
    // the binding points at mission.duplicate (not missionList.actions.*)
    expect(screen.getAllByTitle("mission.duplicate").length).toBeGreaterThan(0);
  });
});

/** child route that records the outlet-context object keys. */
function OutletKeyProbe({ onKeys }: { onKeys: (keys: string[]) => void }) {
  const ctx = useOutletContext<MissionTabOutletContext>();
  useEffect(() => {
    onKeys(Object.keys(ctx).sort());
  }, [ctx, onKeys]);
  return null;
}

describe("MissionTabNav outlet-context shape", () => {
  /** the action-bar/hook split must not perturb the object child pages read. */
  it("exposes a stable set of outlet-context keys", () => {
    let keys: string[] = [];
    render(
      <MemoryRouter initialEntries={["/operator-center/missions/mission-1/configuration"]}>
        <Routes>
          <Route path="/operator-center/missions/:id" element={<MissionTabNav />}>
            <Route
              path="configuration"
              element={<OutletKeyProbe onKeys={(k) => { keys = k; }} />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(keys).toEqual(
      [
        "setSaveContext",
        "setComputeContext",
        "refreshMissions",
        "mission",
        "updateMissionFromPage",
        "leftPanelEl",
        "setCompactLeftPanel",
      ].sort(),
    );
  });
});

describe("MissionTabNav duplicate action", () => {
  /** duplicate must call the API, refresh, and navigate to the copy. */
  beforeEach(() => {
    hoistedNavigate.mockClear();
    hoistedRefresh.mockClear();
    vi.mocked(duplicateMission).mockClear();
  });

  it("invokes duplicateMission + refresh and navigates to the copy", async () => {
    renderComponent();
    fireEvent.click(screen.getAllByTitle("mission.duplicate")[0]);

    await waitFor(() => expect(vi.mocked(duplicateMission)).toHaveBeenCalledWith("mission-1"));
    await waitFor(() => expect(hoistedRefresh).toHaveBeenCalled());
    await waitFor(() =>
      expect(hoistedNavigate).toHaveBeenCalledWith(
        "/operator-center/missions/copy-1/configuration",
      ),
    );
  });
});

describe("MissionTabNav compute trajectory button", () => {
  /** tests for the compute button busy state styling. */
  it("uses solid bg-tv-accent-busy when computing (no translucent /50 fill)", async () => {
    renderWithComputeContext({
      onCompute: vi.fn(),
      canCompute: true,
      isComputing: true,
    });

    const btn = await screen.findByTestId("compute-trajectory-btn");
    expect(btn.className).toContain("bg-tv-accent-busy");
    expect(btn.className).not.toContain("bg-tv-accent/50");
    expect(btn).toHaveTextContent("mission.config.computing");
  });

  it("uses solid bg-tv-accent in idle/ready state", async () => {
    renderWithComputeContext({
      onCompute: vi.fn(),
      canCompute: true,
      isComputing: false,
    });

    const btn = await screen.findByTestId("compute-trajectory-btn");
    expect(btn.className).toMatch(/(^|\s)bg-tv-accent(\s|$)/);
    expect(btn.className).not.toContain("bg-tv-accent-busy");
  });
});
