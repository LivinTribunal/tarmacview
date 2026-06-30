import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Copy, Trash2, Star, ArrowLeftRight } from "lucide-react";
import RowActionButtons from "@/components/common/RowActionButtons";
import DroneTable from "./DroneTable";
import type { DroneProfileResponse } from "@/types/droneProfile";

vi.mock("@/components/drone/DroneModelThumbnail", () => ({
  default: () => <div data-testid="drone-thumb" />,
}));

function makeDrone(
  overrides: Partial<DroneProfileResponse> &
    Pick<DroneProfileResponse, "id" | "name">,
): DroneProfileResponse {
  return {
    manufacturer: "DJI",
    model: "M30",
    max_speed: 10,
    max_climb_rate: null,
    max_altitude: null,
    battery_capacity: null,
    endurance_minutes: 30,
    camera_resolution: null,
    camera_frame_rate: null,
    sensor_fov: null,
    weight: null,
    model_identifier: null,
    max_optical_zoom: null,
    sensor_base_focal_length: null,
    default_optical_zoom: null,
    supports_geozone_upload: false,
    supports_dji_wpml: false,
    is_dji: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    mission_count: 0,
    ...overrides,
  };
}

const D1 = makeDrone({ id: "d-1", name: "Alpha" });
const D2 = makeDrone({ id: "d-2", name: "Bravo" });

type Props = React.ComponentProps<typeof DroneTable>;

function renderTable(overrides: Partial<Props> = {}) {
  const props: Props = {
    rows: [D1, D2],
    totalDrones: 2,
    loading: false,
    error: false,
    sortKey: "name",
    sortDir: "asc",
    onSort: vi.fn(),
    onRowClick: vi.fn(),
    onRetry: vi.fn(),
    renderRowActions: () => null,
    ...overrides,
  };
  return { ...render(<DroneTable {...props} />), props };
}

describe("DroneTable", () => {
  it("renders rows and fires onRowClick", () => {
    const { props } = renderTable();
    expect(screen.getByTestId("drone-row-d-1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("drone-row-d-1"));
    expect(props.onRowClick).toHaveBeenCalledWith(D1);
  });

  it("fires onSort when a header is clicked", () => {
    const { props } = renderTable();
    fireEvent.click(screen.getByText("coordinator.drones.columns.name"));
    expect(props.onSort).toHaveBeenCalledWith("name");
  });

  it("coordinator mode: no default badge, duplicate + delete actions fire", () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    renderTable({
      renderRowActions: (drone) => (
        <RowActionButtons
          actions={[
            { icon: Copy, onClick: () => onDuplicate(drone), title: "duplicate" },
            { icon: Trash2, onClick: () => onDelete(drone), title: "delete" },
          ]}
        />
      ),
    });
    expect(screen.queryByText("operatorDrones.defaultBadge")).not.toBeInTheDocument();
    const row = screen.getByTestId("drone-row-d-1");
    fireEvent.click(within(row).getByTitle("duplicate"));
    expect(onDuplicate).toHaveBeenCalledWith(D1);
    fireEvent.click(within(row).getByTitle("delete"));
    expect(onDelete).toHaveBeenCalledWith(D1);
  });

  it("operator mode: marks the default row with a badge and fires star + bulk", () => {
    const onToggle = vi.fn();
    const onBulk = vi.fn();
    renderTable({
      defaultDroneId: "d-1",
      renderRowActions: (drone, isDefault) => (
        <RowActionButtons
          actions={[
            {
              icon: Star,
              onClick: () => onToggle(drone),
              title: isDefault ? "remove-default" : "set-default",
              filled: isDefault,
            },
            { icon: ArrowLeftRight, onClick: () => onBulk(), title: "bulk" },
          ]}
        />
      ),
    });
    // only the default row shows the badge
    expect(screen.getAllByText("operatorDrones.defaultBadge")).toHaveLength(1);
    const row1 = screen.getByTestId("drone-row-d-1");
    expect(within(row1).getByText("operatorDrones.defaultBadge")).toBeInTheDocument();
    const row2 = screen.getByTestId("drone-row-d-2");
    expect(within(row2).queryByText("operatorDrones.defaultBadge")).not.toBeInTheDocument();
    fireEvent.click(within(row1).getByTitle("remove-default"));
    expect(onToggle).toHaveBeenCalledWith(D1);
    fireEvent.click(within(row1).getByTitle("bulk"));
    expect(onBulk).toHaveBeenCalled();
  });

  it("renders the loading spinner", () => {
    const { container } = renderTable({ loading: true });
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("drone-row-d-1")).not.toBeInTheDocument();
  });

  it("renders the error block and retries", () => {
    const onRetry = vi.fn();
    renderTable({ error: true, onRetry });
    expect(screen.getByText("coordinator.drones.loadError")).toBeInTheDocument();
    fireEvent.click(screen.getByText("common.retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows noDrones when empty and unfiltered, noMatch when filtered", () => {
    const { unmount } = renderTable({ rows: [], totalDrones: 0 });
    expect(screen.getByText("coordinator.drones.noDrones")).toBeInTheDocument();
    unmount();
    renderTable({ rows: [], totalDrones: 5 });
    expect(screen.getByText("coordinator.drones.noMatch")).toBeInTheDocument();
  });
});
