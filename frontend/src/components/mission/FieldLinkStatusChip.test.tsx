import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import FieldLinkStatusChip from "./FieldLinkStatusChip";
import type {
  FieldLinkDevice,
  FieldLinkStatusResponse,
} from "@/types/fieldLink";

/** resolve a dotted i18n key against the real en.json bundle. */
function resolveKey(key: string): string {
  const parts = key.split(".");
  let node: unknown = en as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

// override the global react-i18next mock with one backed by the real en.json
// (incl. {{model}} interpolation) so assertions verify user-facing copy.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let value = resolveKey(key);
      for (const [k, v] of Object.entries(opts ?? {})) {
        value = value.replace(`{{${k}}}`, String(v));
      }
      return value;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
      options: { resources: { en: {} } },
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const RC_PLUS: FieldLinkDevice = {
  sn: "5YSZK1400B00A1",
  model_name: "DJI RC Plus",
  model_key: "2-119-0",
  domain: 2,
  online: true,
  bound: true,
  gateway_sn: null,
};

const M350: FieldLinkDevice = {
  sn: "1ZNBJ7R0010078",
  model_name: "Matrice 350 RTK",
  model_key: "0-89-0",
  domain: 0,
  online: true,
  bound: true,
  gateway_sn: "5YSZK1400B00A1",
};

function makeStatus(
  overrides: Partial<FieldLinkStatusResponse> = {},
): FieldLinkStatusResponse {
  return { hub_online: true, broker_connected: true, devices: [], ...overrides };
}

describe("FieldLinkStatusChip", () => {
  it("renders nothing until the first status response arrives", () => {
    render(<FieldLinkStatusChip status={null} />);

    expect(screen.queryByTestId("field-link-chip")).toBeNull();
  });

  it("renders the no-hub state when the backend reports the hub offline", () => {
    render(<FieldLinkStatusChip status={makeStatus({ hub_online: false })} />);

    const chip = screen.getByTestId("field-link-chip");
    expect(chip).toHaveAttribute("data-state", "noHub");
    expect(chip.textContent).toBe("Field hub not connected");
  });

  it("renders the offline state when the hub is up but no device is online", () => {
    render(
      <FieldLinkStatusChip
        status={makeStatus({ devices: [{ ...RC_PLUS, online: false }] })}
      />,
    );

    const chip = screen.getByTestId("field-link-chip");
    expect(chip).toHaveAttribute("data-state", "offline");
    expect(chip.textContent).toBe("RC offline");
  });

  it("renders the online state preferring the aircraft model", () => {
    render(<FieldLinkStatusChip status={makeStatus({ devices: [RC_PLUS, M350] })} />);

    const chip = screen.getByTestId("field-link-chip");
    expect(chip).toHaveAttribute("data-state", "online");
    expect(chip.textContent).toBe("RC connected – Matrice 350 RTK");
  });

  it("falls back to model-less copy for unknown devices", () => {
    render(
      <FieldLinkStatusChip
        status={makeStatus({ devices: [{ ...RC_PLUS, model_name: null }] })}
      />,
    );

    const chip = screen.getByTestId("field-link-chip");
    expect(chip).toHaveAttribute("data-state", "online");
    expect(chip.textContent).toBe("RC connected");
  });
});
