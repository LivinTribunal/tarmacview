import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AGLResponse } from "@/types/airport";
import CreateTemplateDialog from "./CreateTemplateDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

const PAPI_AGL = {
  id: "agl-1",
  surface_id: "surface-1",
  agl_type: "PAPI",
  name: "PAPI A",
  position: { type: "Point", coordinates: [14.27, 50.1, 0] },
  side: null,
  glide_slope_angle: null,
  distance_from_threshold: null,
  offset_from_centerline: null,
  lhas: [],
} as unknown as AGLResponse;

function renderDialog(onClose = vi.fn()) {
  return render(
    <CreateTemplateDialog
      isOpen
      onClose={onClose}
      agls={[PAPI_AGL]}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

function nameInput() {
  return screen.getByTestId("create-template-name") as HTMLInputElement;
}

describe("CreateTemplateDialog name prefill", () => {
  it("keeps a typed name when method changes afterwards", () => {
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "My Custom Name" } });
    fireEvent.change(screen.getByTestId("create-template-method"), {
      target: { value: "HOVER_POINT_LOCK" },
    });
    expect(nameInput().value).toBe("My Custom Name");
  });

  it("prefills the name from the method when untouched", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-template-method"), {
      target: { value: "HOVER_POINT_LOCK" },
    });
    expect(nameInput().value).toBe("map.inspectionMethod.HOVER_POINT_LOCK");
  });

  it("prefills from agl + method for an agl-requiring method when untouched", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-template-method"), {
      target: { value: "HORIZONTAL_RANGE" },
    });
    fireEvent.change(screen.getByTestId("create-template-agl"), {
      target: { value: PAPI_AGL.id },
    });
    expect(nameInput().value).toBe(
      "PAPI A - map.inspectionMethod.HORIZONTAL_RANGE",
    );
  });

  it("does not re-prefill an emptied name once edited", () => {
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "typed" } });
    fireEvent.change(nameInput(), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("create-template-method"), {
      target: { value: "HOVER_POINT_LOCK" },
    });
    expect(nameInput().value).toBe("");
  });

  it("re-enables prefill after the form is reset on close", () => {
    renderDialog();
    fireEvent.change(nameInput(), { target: { value: "My Custom Name" } });
    fireEvent.click(screen.getByText("common.cancel"));
    fireEvent.change(screen.getByTestId("create-template-method"), {
      target: { value: "HOVER_POINT_LOCK" },
    });
    expect(nameInput().value).toBe("map.inspectionMethod.HOVER_POINT_LOCK");
  });
});
