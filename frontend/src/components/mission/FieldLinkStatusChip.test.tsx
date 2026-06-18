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
  return {
    hub_online: true,
    rc_connected: false,
    broker_connected: true,
    devices: [],
    connect_url: null,
    public_host: null,
    ...overrides,
  };
}

describe("FieldLinkStatusChip", () => {
  it("renders nothing until the first status response arrives", () => {
    render(<FieldLinkStatusChip status={null} />);

    expect(screen.queryByTestId("field-link-chip")).toBeNull();
  });

  it("RC shows no-hub when the backend reports the hub offline", () => {
    render(<FieldLinkStatusChip status={makeStatus({ hub_online: false })} />);

    const rc = screen.getByTestId("field-link-rc");
    expect(rc).toHaveAttribute("data-state", "noHub");
    expect(rc.textContent).toBe("Field hub not connected");
  });

  it("RC shows connected from the pilot session, independent of MQTT devices", () => {
    render(<FieldLinkStatusChip status={makeStatus({ rc_connected: true, devices: [] })} />);

    const rc = screen.getByTestId("field-link-rc");
    expect(rc).toHaveAttribute("data-state", "online");
    expect(rc.textContent).toBe("RC connected");
  });

  it("RC shows offline when the hub is up but pilot has no session", () => {
    render(<FieldLinkStatusChip status={makeStatus({ rc_connected: false })} />);

    const rc = screen.getByTestId("field-link-rc");
    expect(rc).toHaveAttribute("data-state", "offline");
    expect(rc.textContent).toBe("RC offline");
  });

  it("MQTT reflects a real device online, not just the broker link or rc session", () => {
    // pilot session + broker up, but NO drone on mqtt -> MQTT disconnected
    const { rerender } = render(
      <FieldLinkStatusChip
        status={makeStatus({
          rc_connected: true,
          broker_connected: true,
          devices: [{ ...RC_PLUS, online: false }],
        })}
      />,
    );
    expect(screen.getByTestId("field-link-mqtt")).toHaveAttribute("data-state", "off");
    expect(screen.getByTestId("field-link-mqtt").textContent).toBe("MQTT disconnected");

    // a drone live on mqtt -> MQTT connected
    rerender(<FieldLinkStatusChip status={makeStatus({ devices: [M350] })} />);
    expect(screen.getByTestId("field-link-mqtt")).toHaveAttribute("data-state", "on");
    expect(screen.getByTestId("field-link-mqtt").textContent).toBe("MQTT connected");
  });
});
