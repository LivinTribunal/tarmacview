import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SurfaceResponse } from "@/types/airport";
import LhaFields from "./LhaFields";

function makePapiSurface(lhaCount: number): SurfaceResponse {
  /** one surface holding a single PAPI agl with lhaCount lights. */
  const lhas = Array.from({ length: lhaCount }, (_, i) => ({
    id: `lha-${i + 1}`,
    sequence_number: i + 1,
  }));
  return {
    id: "srf-1",
    agls: [{ id: "agl-1", agl_type: "PAPI", lhas }],
  } as unknown as SurfaceResponse;
}

function makeEdgeSurface(): SurfaceResponse {
  /** one surface holding a single non-PAPI agl. */
  return {
    id: "srf-1",
    agls: [{ id: "agl-1", agl_type: "EDGE", lhas: [{ id: "lha-1", sequence_number: 1 }] }],
  } as unknown as SurfaceResponse;
}

function renderFields(
  data: Record<string, unknown>,
  surfaces: SurfaceResponse[],
  values: Record<string, string> = {},
) {
  const handleChange = vi.fn();
  const onUpdate = vi.fn();
  const val = (k: string) => values[k] ?? "";
  render(
    <LhaFields
      data={data}
      val={val}
      handleChange={handleChange}
      onUpdate={onUpdate}
      surfaces={surfaces}
      seqDraft={null}
      setSeqDraft={vi.fn()}
      seqError={null}
      setSeqError={vi.fn()}
    />,
  );
  return { handleChange, onUpdate };
}

describe("LhaFields PAPI designator dropdown", () => {
  it("offers only as many letters as the agl has lights", () => {
    renderFields({ agl_id: "agl-1", sequence_number: 1 }, [makePapiSurface(3)]);
    const select = screen.getByTestId("feat-unit-designator");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["A", "B", "C"]);
  });

  it("offers all four letters when the agl has four lights", () => {
    renderFields({ agl_id: "agl-1", sequence_number: 1 }, [makePapiSurface(4)]);
    const select = screen.getByTestId("feat-unit-designator");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["A", "B", "C", "D"]);
  });

  it("caps at four letters even if more lights somehow exist", () => {
    renderFields({ agl_id: "agl-1", sequence_number: 1 }, [makePapiSurface(6)]);
    const select = screen.getByTestId("feat-unit-designator");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["A", "B", "C", "D"]);
  });

  it("maps a selected letter back to its 1-based sequence_number", () => {
    const { handleChange } = renderFields(
      { agl_id: "agl-1", sequence_number: 1 },
      [makePapiSurface(3)],
    );
    fireEvent.change(screen.getByTestId("feat-unit-designator"), { target: { value: "C" } });
    expect(handleChange).toHaveBeenCalledWith("sequence_number", 3);
  });

  it("renders the numeric sequence input, not the dropdown, for non-PAPI agls", () => {
    renderFields({ agl_id: "agl-1", sequence_number: 1 }, [makeEdgeSurface()]);
    expect(screen.getByTestId("feat-sequence-number")).toBeInTheDocument();
    expect(screen.queryByTestId("feat-unit-designator")).not.toBeInTheDocument();
  });
});
