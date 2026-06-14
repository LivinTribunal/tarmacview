import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MapFeature } from "@/types/map";
import FeatureEditorPanel from "./FeatureEditorPanel";

vi.mock("@/components/coordinator/CreationForm", () => ({
  default: () => <div data-testid="creation-form" />,
}));
vi.mock("@/components/map/overlays/MeasureInfoCard", () => ({
  default: () => <div data-testid="measure-info" />,
}));
vi.mock("@/components/map/overlays/HeadingInfoCard", () => ({
  default: () => <div data-testid="heading-info" />,
}));

interface EditablePropsCapture {
  pickingTouchpoint?: boolean;
  onPickTouchpointToggle?: () => void;
  pickingLha?: string | null;
  onPickLhaToggle?: (which: string) => void;
}
const editableProps: EditablePropsCapture[] = [];
vi.mock("@/components/coordinator/EditableFeatureInfo", () => ({
  default: (props: EditablePropsCapture) => {
    editableProps.push(props);
    return <div data-testid="editable-feature" />;
  },
}));

type Props = React.ComponentProps<typeof FeatureEditorPanel>;

function makeCreation(pending = false): Props["creation"] {
  /** minimal entity-creation stub; pending toggles the ladder's first branch. */
  return {
    pendingGeometry: null,
    pendingPointPosition: pending ? [1, 2] : null,
    pendingGeometryType: null,
    pendingCircleRadius: null,
    pendingCircleCenter: null,
    boundaryEntityOverride: null,
    handleCreationCancel: vi.fn(),
    handleCreate: vi.fn(),
    handleAddLha: vi.fn(),
    prefilledGeometry: {},
  } as unknown as Props["creation"];
}

function makePicking(): Props["picking"] {
  /** picking stub with distinguishable touchpoint/lha state. */
  return {
    pickingTouchpoint: true,
    setPickingTouchpoint: vi.fn(),
    pickedTouchpointCoord: null,
    setPickedTouchpointCoord: vi.fn(),
    pickingLha: "start",
    setPickingLha: vi.fn(),
    pickedLhaCoord: null,
    setPickedLhaCoord: vi.fn(),
    pickingThreshold: false,
    setPickingThreshold: vi.fn(),
    pickedThresholdCoord: null,
    setPickedThresholdCoord: vi.fn(),
    pickingEnd: false,
    setPickingEnd: vi.fn(),
    pickedEndCoord: null,
    setPickedEndCoord: vi.fn(),
    anyPicking: false,
    handlePickingMapClick: vi.fn(),
  } as unknown as Props["picking"];
}

function makeMeasure(isComplete = false): Props["measure"] {
  /** measure stub; isComplete drives the measure branch. */
  return {
    isComplete,
    totalDistance: 120,
    segments: [{}],
    dismiss: vi.fn(),
  } as unknown as Props["measure"];
}

function makeHeading(isComplete = false): Props["heading"] {
  /** heading stub; isComplete + bearing drive the heading branch. */
  return {
    isComplete,
    bearing: isComplete ? 90 : null,
    dismiss: vi.fn(),
  } as unknown as Props["heading"];
}

function renderPanel(overrides: Partial<Props> = {}) {
  /** render the ladder with all branches inactive by default. */
  const props: Props = {
    t: (k: string) => k,
    airportId: "apt-1",
    airportElevation: 100,
    surfaces: [],
    obstacles: [],
    safetyZones: [],
    selectedFeature: null,
    setSelectedFeature: vi.fn(),
    creation: makeCreation(false),
    picking: makePicking(),
    measure: makeMeasure(false),
    heading: makeHeading(false),
    elevationResolver: undefined,
    onFeatureUpdate: vi.fn(),
    onFeatureDelete: vi.fn().mockResolvedValue(undefined),
    getPendingChange: vi.fn().mockReturnValue(null),
    fetchAirport: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return { ...render(<FeatureEditorPanel {...props} />), props };
}

describe("FeatureEditorPanel ladder precedence", () => {
  beforeEach(() => {
    editableProps.length = 0;
  });

  it("renders the creation form first even when measure is complete", () => {
    renderPanel({ creation: makeCreation(true), measure: makeMeasure(true) });
    expect(screen.getByTestId("creation-form")).toBeInTheDocument();
    expect(screen.queryByTestId("measure-info")).not.toBeInTheDocument();
  });

  it("renders measure info when complete and nothing pending", () => {
    renderPanel({ measure: makeMeasure(true) });
    expect(screen.getByTestId("measure-info")).toBeInTheDocument();
  });

  it("renders heading info when complete with a bearing", () => {
    renderPanel({ heading: makeHeading(true) });
    expect(screen.getByTestId("heading-info")).toBeInTheDocument();
  });

  it("renders the feature editor for a selected non-waypoint feature", () => {
    renderPanel({
      selectedFeature: {
        type: "surface",
        data: { id: "s1", agls: [], paired_surface_id: null },
      } as unknown as MapFeature,
    });
    expect(screen.getByTestId("editable-feature")).toBeInTheDocument();
  });

  it("renders nothing for a waypoint selection", () => {
    const { container } = renderPanel({
      selectedFeature: { type: "waypoint", data: { id: "w1" } } as unknown as MapFeature,
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no branch is active", () => {
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FeatureEditorPanel picking-prop gating", () => {
  beforeEach(() => {
    editableProps.length = 0;
  });

  it("passes surface picking props but no lha bridge for a surface feature", () => {
    renderPanel({
      selectedFeature: {
        type: "surface",
        data: { id: "s1", agls: [], paired_surface_id: null },
      } as unknown as MapFeature,
    });
    const p = editableProps[editableProps.length - 1];
    expect(p.pickingTouchpoint).toBe(true);
    expect(p.onPickTouchpointToggle).toBeTypeOf("function");
    expect(p.pickingLha).toBeNull();
    expect(p.onPickLhaToggle).toBeUndefined();
  });

  it("passes lha picking props but no touchpoint bridge for an agl feature", () => {
    renderPanel({
      selectedFeature: {
        type: "agl",
        data: { id: "a1" },
      } as unknown as MapFeature,
    });
    const p = editableProps[editableProps.length - 1];
    expect(p.pickingLha).toBe("start");
    expect(p.onPickLhaToggle).toBeTypeOf("function");
    expect(p.pickingTouchpoint).toBe(false);
    expect(p.onPickTouchpointToggle).toBeUndefined();
  });
});
