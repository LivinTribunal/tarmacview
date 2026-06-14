import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SurfaceScanFields from "./SurfaceScanFields";
import type { SurfaceResponse } from "@/types/airport";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { InspectionConfigOverride } from "@/types/mission";

const SURFACES = [
  { id: "rwy-1", identifier: "09/27", surface_type: "RUNWAY", width: 45 },
  { id: "twy-1", identifier: "A", surface_type: "TAXIWAY", width: 20 },
] as unknown as SurfaceResponse[];

const DRONE = { id: "d1", sensor_fov: 84 } as unknown as DroneProfileResponse;

function renderFields(
  override: InspectionConfigOverride = {},
  drone: DroneProfileResponse | null = DRONE,
) {
  const onChange = vi.fn();
  const onNumberChange = vi.fn();
  render(
    <SurfaceScanFields
      surfaces={SURFACES}
      savedConfig={null}
      defaultConfig={null}
      droneProfile={drone}
      configOverride={override}
      onChange={onChange}
      onNumberChange={onNumberChange}
    />,
  );
  return { onChange, onNumberChange };
}

describe("SurfaceScanFields", () => {
  it("lists the airport surfaces in the picker", () => {
    renderFields();
    const select = screen.getByTestId("scan-surface");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /09\/27/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^A /i })).toBeInTheDocument();
  });

  it("selecting a surface emits scan_surface_id", () => {
    const { onChange } = renderFields();
    fireEvent.change(screen.getByTestId("scan-surface"), {
      target: { value: "rwy-1" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scan_surface_id: "rwy-1" }),
    );
  });

  it("renders the three length-mode toggle buttons", () => {
    renderFields();
    expect(screen.getByTestId("scan-length-mode-full")).toBeInTheDocument();
    expect(screen.getByTestId("scan-length-mode-max_length")).toBeInTheDocument();
    expect(screen.getByTestId("scan-length-mode-interval")).toBeInTheDocument();
  });

  it("shows from + to inputs only for INTERVAL mode", () => {
    renderFields({ scan_length_mode: "INTERVAL" });
    expect(screen.getByTestId("scan-length-from")).toBeInTheDocument();
    expect(screen.getByTestId("scan-length-to")).toBeInTheDocument();
  });

  it("MAX_LENGTH shows only the to input", () => {
    renderFields({ scan_length_mode: "MAX_LENGTH" });
    expect(screen.queryByTestId("scan-length-from")).not.toBeInTheDocument();
    expect(screen.getByTestId("scan-length-to")).toBeInTheDocument();
  });

  it("FULL mode hides the length window inputs", () => {
    renderFields({ scan_length_mode: "FULL" });
    expect(screen.queryByTestId("scan-length-from")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scan-length-to")).not.toBeInTheDocument();
  });

  it("shows the computed-optimal run-count hint when surface + FOV are known", () => {
    renderFields({ scan_surface_id: "rwy-1" });
    expect(screen.getByTestId("scan-run-count-hint")).toBeInTheDocument();
  });

  it("hides the run-count hint when the drone has no sensor FOV", () => {
    renderFields({ scan_surface_id: "rwy-1", scan_width: 45 }, {
      id: "d2",
      sensor_fov: null,
    } as unknown as DroneProfileResponse);
    expect(screen.queryByTestId("scan-run-count-hint")).not.toBeInTheDocument();
  });

  it("emits scan_width_side when a side is picked (with a width set)", () => {
    const { onChange } = renderFields({ scan_width: 20 });
    fireEvent.click(screen.getByTestId("scan-width-side-left"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ scan_width_side: "LEFT" }),
    );
  });

  it("renders both run orientation options", () => {
    renderFields();
    expect(screen.getByTestId("scan-orientation-length_wise")).toBeInTheDocument();
    expect(screen.getByTestId("scan-orientation-width_wise")).toBeInTheDocument();
  });

  it("emits numeric changes for height, sidelap and run count", () => {
    const { onNumberChange } = renderFields();
    fireEvent.change(screen.getByTestId("scan-height"), { target: { value: "12" } });
    expect(onNumberChange).toHaveBeenCalledWith("scan_height", "12");
    fireEvent.change(screen.getByTestId("scan-sidelap"), { target: { value: "30" } });
    expect(onNumberChange).toHaveBeenCalledWith("scan_sidelap_percent", "30");
    fireEvent.change(screen.getByTestId("scan-run-count"), { target: { value: "5" } });
    expect(onNumberChange).toHaveBeenCalledWith("scan_run_count", "5");
  });
});
