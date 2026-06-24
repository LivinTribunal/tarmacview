import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SendToDroneSection from "./SendToDroneSection";
import { dispatchMission } from "@/api/missions";
import type {
  FieldLinkDevice,
  FieldLinkStatusResponse,
  WaylineDispatchResponse,
} from "@/types/fieldLink";

vi.mock("@/api/missions", () => ({
  dispatchMission: vi.fn(),
}));

const mockedDispatch = vi.mocked(dispatchMission);

const M350: FieldLinkDevice = {
  sn: "1ZNBJ7R0010078",
  model_name: "Matrice 350 RTK",
  model_key: "0-89-0",
  domain: 0,
  online: true,
  bound: true,
  gateway_sn: "5YSZK1400B00A1",
};

const LINK_ONLINE: FieldLinkStatusResponse = {
  hub_online: true,
  rc_connected: true,
  broker_connected: true,
  devices: [M350],
  connect_url: "http://192.168.8.50:8080",
  public_host: "192.168.8.50",
};

const DISPATCH: WaylineDispatchResponse = {
  id: "d-1",
  mission_id: "m-1",
  wayline_id: "w-1",
  device_sn: null,
  status: "DISPATCHED",
  dispatched_at: "2026-06-10T10:00:00Z",
};

function renderSection(
  overrides: Partial<Parameters<typeof SendToDroneSection>[0]> = {},
) {
  const props = {
    missionId: "m-1",
    missionStatus: "VALIDATED" as const,
    linkStatus: LINK_ONLINE,
    onDispatched: vi.fn(),
    ...overrides,
  };
  return { ...render(<SendToDroneSection {...props} />), props };
}

beforeEach(() => {
  mockedDispatch.mockReset();
});

describe("SendToDroneSection", () => {
  it("enables the button when the link is online and the mission is exportable", () => {
    renderSection();

    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("disables the button when the hub is offline", () => {
    renderSection({
      linkStatus: {
        hub_online: false,
        rc_connected: false,
        broker_connected: false,
        devices: [],
        connect_url: null,
        public_host: null,
      },
    });

    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });

  it("enables the button when the hub is online but no drone is connected", () => {
    // sending only needs the hub - the rc pulls the route library whenever it
    // next connects, so dispatch must not depend on a live drone link.
    renderSection({
      linkStatus: { ...LINK_ONLINE, devices: [{ ...M350, online: false }] },
    });

    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("disables the button before the first poll response", () => {
    renderSection({ linkStatus: null });

    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });

  it.each(["DRAFT", "PLANNED", "COMPLETED", "CANCELLED"] as const)(
    "disables the button for %s missions",
    (status) => {
      renderSection({ missionStatus: status });

      expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
    },
  );

  it("allows dispatch for EXPORTED missions (re-dispatch)", () => {
    renderSection({ missionStatus: "EXPORTED" });

    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("allows dispatch for MEASURED missions (re-send after measuring)", () => {
    renderSection({ missionStatus: "MEASURED" });

    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("shows the success message and refetches after a dispatch", async () => {
    mockedDispatch.mockResolvedValue({ kind: "dispatched", dispatch: DISPATCH });
    const { props } = renderSection();

    fireEvent.click(screen.getByTestId("send-to-drone-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-drone-success")).toBeInTheDocument(),
    );
    expect(mockedDispatch).toHaveBeenCalledWith("m-1", {
      acknowledge_altitude_clamps: false,
    });
    expect(props.onDispatched).toHaveBeenCalledTimes(1);
  });

  it("shows the backend detail message when the dispatch fails", async () => {
    mockedDispatch.mockRejectedValue({
      response: { data: { detail: { message: "field hub unreachable" } } },
    });
    const { props } = renderSection();

    fireEvent.click(screen.getByTestId("send-to-drone-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-drone-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("send-to-drone-error").textContent).toBe(
      "field hub unreachable",
    );
    expect(props.onDispatched).not.toHaveBeenCalled();
  });

  it("falls back to the generic error copy when the failure has no detail", async () => {
    mockedDispatch.mockRejectedValue(new Error("boom"));
    renderSection();

    fireEvent.click(screen.getByTestId("send-to-drone-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-drone-error").textContent).toBe(
        "mission.sendToDrone.error",
      ),
    );
  });

  it("surfaces a clamp warning and re-dispatches with the acknowledgment", async () => {
    mockedDispatch.mockResolvedValueOnce({ kind: "clamp_warning", clamps: [] });
    mockedDispatch.mockResolvedValueOnce({ kind: "dispatched", dispatch: DISPATCH });
    const { props } = renderSection();

    fireEvent.click(screen.getByTestId("send-to-drone-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("send-to-drone-clamps")).toBeInTheDocument(),
    );
    expect(props.onDispatched).not.toHaveBeenCalled();
    expect(screen.getByTestId("send-to-drone-btn").textContent).toContain(
      "mission.sendToDrone.sendAnyway",
    );

    fireEvent.click(screen.getByTestId("send-to-drone-btn"));
    await waitFor(() =>
      expect(screen.getByTestId("send-to-drone-success")).toBeInTheDocument(),
    );
    expect(mockedDispatch).toHaveBeenLastCalledWith("m-1", {
      acknowledge_altitude_clamps: true,
    });
    expect(props.onDispatched).toHaveBeenCalledTimes(1);
  });
});
