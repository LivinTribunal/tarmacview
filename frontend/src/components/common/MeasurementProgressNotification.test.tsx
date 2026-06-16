import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en.json";
import MeasurementProgressNotification from "./MeasurementProgressNotification";

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

const stableT = (key: string, opts?: Record<string, unknown>) => {
  let value = resolveKey(key);
  for (const [k, v] of Object.entries(opts ?? {})) {
    value = value.replace(`{{${k}}}`, String(v));
  }
  return value;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en", changeLanguage: vi.fn() } }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const { progressHolder } = vi.hoisted(() => ({ progressHolder: { current: 0 } }));
vi.mock("@/contexts/MeasurementProgressContext", () => ({
  useMeasurementProgress: () => ({
    activeCount: progressHolder.current,
    track: vi.fn(),
    sync: vi.fn(),
  }),
}));

describe("MeasurementProgressNotification", () => {
  beforeEach(() => {
    progressHolder.current = 0;
  });

  it("renders nothing when no run is active", () => {
    render(<MeasurementProgressNotification />);
    expect(
      screen.queryByTestId("measurement-progress-notification"),
    ).not.toBeInTheDocument();
  });

  it("renders the active count while runs are processing", () => {
    progressHolder.current = 3;
    render(<MeasurementProgressNotification />);
    expect(
      screen.getByTestId("measurement-progress-notification"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 measurement(s) processing")).toBeInTheDocument();
  });
});
