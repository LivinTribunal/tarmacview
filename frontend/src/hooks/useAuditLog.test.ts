import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import useAuditLog from "./useAuditLog";

// stable t reference so fetchLogs (which depends on t) keeps a stable identity
const stableT = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockListAuditLogs = vi.fn();
const mockExportAuditLog = vi.fn();
const mockListAirportsAdmin = vi.fn();

vi.mock("@/api/admin", () => ({
  listAuditLogs: (...a: unknown[]) => mockListAuditLogs(...a),
  exportAuditLog: (...a: unknown[]) => mockExportAuditLog(...a),
  listAirportsAdmin: (...a: unknown[]) => mockListAirportsAdmin(...a),
}));

function setup(initialPath = "/super-admin/audit-log") {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initialPath] }, children);
  return renderHook(() => useAuditLog(), { wrapper });
}

describe("useAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAuditLogs.mockResolvedValue({ data: [{ id: "log-1" }], meta: { total: 1 } });
    mockListAirportsAdmin.mockResolvedValue({
      data: [{ id: "apt-9", icao_code: "LZIB", name: "Bratislava" }],
    });
  });

  it("sends the verbatim param object with empty filters mapped to undefined", async () => {
    setup();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));
    expect(mockListAuditLogs).toHaveBeenLastCalledWith({
      search: undefined,
      action: undefined,
      entity_type: undefined,
      airport_id: undefined,
      date_from: undefined,
      date_to: undefined,
      sort_by: "timestamp",
      sort_dir: "desc",
      limit: 20,
      offset: 0,
    });
  });

  it("toggleAction sets then clears the single-select action filter", async () => {
    const { result } = setup();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));
    act(() => result.current.toggleAction("LOGIN"));
    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: "LOGIN" }),
      ),
    );
    act(() => result.current.toggleAction("LOGIN"));
    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: undefined }),
      ),
    );
  });

  it("clearAirportFilter drops only the airport_id param", async () => {
    const { result } = setup("/super-admin/audit-log?airport_id=apt-9");
    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ airport_id: "apt-9" }),
      ),
    );
    act(() => result.current.clearAirportFilter());
    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ airport_id: undefined }),
      ),
    );
    expect(result.current.airportIdFilter).toBeNull();
  });

  it("handleExport downloads a csv blob via the anchor dance", async () => {
    mockExportAuditLog.mockResolvedValue(new Blob(["csv"]));
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const anchor = { href: "", download: "", click: vi.fn() };
    const realCreate = Document.prototype.createElement;
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation(function (this: Document, tag: string) {
        if (tag === "a") return anchor as unknown as HTMLAnchorElement;
        return realCreate.call(this, tag);
      });

    const { result } = setup();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockExportAuditLog).toHaveBeenCalledWith({
      date_from: undefined,
      date_to: undefined,
      airport_id: undefined,
    });
    expect(anchor.href).toBe("blob:mock");
    expect(anchor.download).toBe("audit-log.csv");
    expect(anchor.click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    spy.mockRestore();
  });
});
