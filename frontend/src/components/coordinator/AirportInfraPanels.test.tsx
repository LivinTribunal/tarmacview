import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type {
  ObstacleResponse,
  SafetyZoneResponse,
  SurfaceResponse,
} from "@/types/airport";
import AirportInfraPanels from "./AirportInfraPanels";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/coordinator/CoordinatorAGLPanel", () => ({
  default: () => <div data-testid="coordinator-agl-panel" />,
}));

// capture the warnings the list panel forwards to the confirm dialog
const confirmDialogProps: { warnings?: string[] }[] = [];
vi.mock("./ConfirmDeleteDialog", () => ({
  default: (props: { warnings?: string[] }) => {
    confirmDialogProps.push(props);
    return null;
  },
}));

const rwy1 = {
  id: "s1",
  identifier: "09",
  surface_type: "RUNWAY",
  paired_surface_id: "s2",
  length: 1000,
  width: 30,
  agls: [{ name: "PAPI 09" }],
} as unknown as SurfaceResponse;
const rwy2 = {
  id: "s2",
  identifier: "27",
  surface_type: "RUNWAY",
  paired_surface_id: "s1",
  length: 1000,
  width: 30,
  agls: [],
} as unknown as SurfaceResponse;

const obstacle = {
  id: "o1",
  name: "Crane",
  type: "BUILDING",
  height: 25,
} as unknown as ObstacleResponse;

const restrictedZone = {
  id: "z1",
  name: "No-Fly",
  type: "RESTRICTED",
  altitude_floor: 0,
  altitude_ceiling: 100,
  is_active: true,
} as unknown as SafetyZoneResponse;

function renderPanels(
  overrides: Partial<React.ComponentProps<typeof AirportInfraPanels>> = {},
) {
  /** render with a paired-runway airport and stubbed agl panel. */
  const props = {
    t: (k: string) => k,
    surfaces: [rwy1, rwy2],
    orderedSurfaces: [rwy1, rwy2],
    surfacePairPosition: new Map<string, "first" | "second">([
      ["s1", "first"],
      ["s2", "second"],
    ]),
    obstacles: [obstacle],
    boundaryZone: undefined,
    regularSafetyZones: [restrictedZone],
    onFeatureClick: vi.fn(),
    onFeatureLocate: vi.fn(),
    onDeleteSurface: vi.fn().mockResolvedValue(undefined),
    onDeleteObstacle: vi.fn().mockResolvedValue(undefined),
    onDeleteSafetyZone: vi.fn().mockResolvedValue(undefined),
    onDeleteAgl: vi.fn().mockResolvedValue(undefined),
    onDeleteLha: vi.fn().mockResolvedValue(undefined),
    onSetActiveTool: vi.fn(),
    onAddBoundary: vi.fn(),
    ...overrides,
  };
  return { ...render(<AirportInfraPanels {...props} />), props };
}

describe("AirportInfraPanels", () => {
  beforeEach(() => {
    confirmDialogProps.length = 0;
  });

  it("renders the four list panels plus the agl panel", () => {
    renderPanels();
    expect(screen.getByTestId("infra-panel-airport.groundsurfaces")).toBeInTheDocument();
    expect(screen.getByTestId("infra-panel-airport.obstacles")).toBeInTheDocument();
    expect(screen.getByTestId("infra-panel-boundary.airportboundary")).toBeInTheDocument();
    expect(screen.getByTestId("infra-panel-airport.safetyzones")).toBeInTheDocument();
    expect(screen.getByTestId("coordinator-agl-panel")).toBeInTheDocument();
  });

  it("shows the pair-chain badge only on the first-of-pair surface", () => {
    renderPanels();
    expect(screen.getByTestId("surface-pair-chain-s1")).toBeInTheDocument();
    expect(screen.queryByTestId("surface-pair-chain-s2")).not.toBeInTheDocument();
  });

  it("fires onFeatureClick with the surface feature on row click", () => {
    const { props } = renderPanels();
    fireEvent.click(screen.getByTestId("infra-item-s1"));
    expect(props.onFeatureClick).toHaveBeenCalledWith({ type: "surface", data: rwy1 });
  });

  it("wires surface add to the polygon draw tool", () => {
    const { props } = renderPanels();
    fireEvent.click(screen.getByTestId("add-airport.groundsurfaces"));
    expect(props.onSetActiveTool).toHaveBeenCalledWith("drawPolygon");
  });

  it("forwards cascade-delete warnings for a surface with agls and a pair", () => {
    renderPanels();
    const deleteButtons = screen.getAllByTitle("common.delete");
    fireEvent.click(deleteButtons[0]);
    const withWarnings = confirmDialogProps.filter(
      (p) => Array.isArray(p.warnings) && p.warnings.length > 0,
    );
    const latest = withWarnings[withWarnings.length - 1];
    expect(latest.warnings).toContain("coordinator.detail.surfaceHasAgl");
    expect(latest.warnings).toContain("coordinator.detail.surfacePair.deletePairWarning");
  });

  it("offers a boundary add action when no boundary exists yet", () => {
    const { props } = renderPanels();
    fireEvent.click(screen.getByTestId("add-boundary.airportboundary"));
    expect(props.onAddBoundary).toHaveBeenCalledTimes(1);
  });

  it("hides the boundary add action once a boundary zone exists", () => {
    renderPanels({
      boundaryZone: {
        id: "b1",
        name: "Perimeter",
        type: "AIRPORT_BOUNDARY",
      } as unknown as SafetyZoneResponse,
    });
    expect(screen.queryByTestId("add-boundary.airportboundary")).not.toBeInTheDocument();
  });
});
