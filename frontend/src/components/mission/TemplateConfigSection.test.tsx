import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplateConfigSection from "./TemplateConfigSection";
import type { InspectionConfigResponse } from "@/types/inspectionTemplate";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

type Config = Omit<InspectionConfigResponse, "id">;

function cfg(partial: Partial<Config>): Config {
  return partial as unknown as Config;
}

function renderSection(
  config: Config | null,
  method: string,
  onChange = vi.fn(),
) {
  render(
    <TemplateConfigSection
      config={config}
      method={method}
      onChange={onChange}
      onMethodChange={vi.fn()}
      allAgls={[]}
      selectedAglId=""
      onAglChange={vi.fn()}
      selectedLhaIds={new Set()}
      onToggleLha={vi.fn()}
      onSelectAllLhas={vi.fn()}
      onDeselectAllLhas={vi.fn()}
    />,
  );
  return onChange;
}

describe("TemplateConfigSection - custom_tolerances add/delete-key logic", () => {
  it("emits the default key when a value is entered", () => {
    const onChange = renderSection(cfg({}), "HOVER_POINT_LOCK");
    // custom_tolerances is the only step="0.01" number input
    const tolerances = screen
      .getAllByRole("spinbutton")
      .find((el) => (el as HTMLInputElement).step === "0.01") as HTMLInputElement;
    fireEvent.change(tolerances, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith({ custom_tolerances: { default: 2 } });
  });

  it("emits null when the only tolerance key is cleared", () => {
    const onChange = renderSection(
      cfg({ custom_tolerances: { default: 0.5 } }),
      "HOVER_POINT_LOCK",
    );
    const tolerances = screen.getByDisplayValue("0.5") as HTMLInputElement;
    fireEvent.change(tolerances, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ custom_tolerances: null });
  });

  it("preserves sibling tolerance keys when default is cleared", () => {
    const onChange = renderSection(
      cfg({ custom_tolerances: { default: 0.5, edge: 1 } }),
      "HOVER_POINT_LOCK",
    );
    const tolerances = screen.getByDisplayValue("0.5") as HTMLInputElement;
    fireEvent.change(tolerances, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ custom_tolerances: { edge: 1 } });
  });
});

describe("TemplateConfigSection - VERTICAL_PROFILE angle band", () => {
  it("shows the band error when angle_start >= angle_end", () => {
    renderSection(
      cfg({ angle_source: "CUSTOM", angle_start: 10, angle_end: 5 }),
      "VERTICAL_PROFILE",
    );
    expect(screen.getByTestId("template-vp-angle-band-error")).toBeInTheDocument();
  });

  it("hides the band error when angle_start < angle_end", () => {
    renderSection(
      cfg({ angle_source: "CUSTOM", angle_start: 2, angle_end: 8 }),
      "VERTICAL_PROFILE",
    );
    expect(screen.queryByTestId("template-vp-angle-band-error")).toBeNull();
  });
});
